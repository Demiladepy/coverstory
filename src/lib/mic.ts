/**
 * Mic capture: 16 kHz mono PCM16 frames for the STT socket, plus a loudness
 * track alongside them.
 *
 * The loudness track is not instrumentation. The STT words come back with
 * start/end times on the session's audio timeline, and this track is on the
 * same timeline, so a word can be looked up by when it was said and scored for
 * how hard it was said. That is what turns a shout into CAPS in the adult's
 * mouth — cheap, and the moment people laugh.
 *
 * The gate is the push-to-talk key. While it is shut nothing is captured, sent
 * or timed, so the server's audio clock and ours stay the same clock. Leaving
 * it open between turns would stream the empty house at the transcript service
 * and put every word's timing out by however long the player hesitated.
 */

export type MicFrame = { pcm: Int16Array; rms: number; atMs: number };

export type Mic = {
  /**
   * The rate the browser actually gave us, which is not always the one asked
   * for. Whatever it is, the transcript socket has to be told the same number
   * or it reads the audio at the wrong speed.
   */
  sampleRate: number;
  /** ms of audio actually sent — the same clock the server's word times use */
  elapsedMs: () => number;
  /**
   * Put the clock back to zero for a new transcript session.
   *
   * Word times come back relative to the session that produced them, and this
   * track is what they are looked up in, so the two have to start together. A
   * night opens a session per door; without this, every door after the first
   * reads its words against audio from an earlier one, and the shout the
   * player just gave is scored from a sentence minutes old.
   *
   * The loudness history survives it. That is what the speaker's normal level
   * is averaged from, and it is about the person, not the door.
   */
  reset: () => void;
  /** start passing audio through: the key went down */
  open: () => void;
  /** push whatever is part-filled and stop passing: the key came up */
  close: () => void;
  /** peak loudness between two points on the session timeline, 0..1 */
  loudnessBetween: (startMs: number, endMs: number) => number;
  /** loudness over everything captured so far, used as the speaker's baseline */
  baseline: () => number;
  stop: () => void;
};

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) this.port.postMessage(input[0].slice(0));
    return true;
  }
}
registerProcessor("capture", Capture);
`;

export async function startMic(onFrame: (frame: MicFrame) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      // Leave AGC off: it flattens a shout back down to a normal level, which
      // is exactly the signal the game is reading.
      autoGainControl: false,
    },
  });

  // 16 kHz is a request, not a guarantee. Chromium honours it; other engines
  // have historically ignored it and handed back the device rate instead. We
  // take what we are given and tell the transcript socket the truth, because
  // sending 48 kHz audio labelled as 16 kHz makes the server hear everything
  // at a third speed — which looks like catastrophic latency and is not.
  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume();

  const blob = new Blob([WORKLET], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture");

  let gateOpen = false;
  let samples = 0;
  /** this session's timeline, which word times are looked up in */
  let track: { atMs: number; rms: number }[] = [];
  /** every loudness reading of the night, which the speaker's normal comes from */
  const heard: number[] = [];

  // A worklet hands us 128 samples at a time — 8 ms at 16 kHz — and the
  // transcript socket refuses anything under 20 ms. So the PCM is batched into
  // chunks before it goes out. The loudness track is not batched: it stays at
  // the worklet's own resolution, because a shout is a short, sharp thing and
  // 64 ms buckets would smear it away.
  // The socket refuses anything under 20 ms, and how many samples that is
  // depends on the rate we were actually given: 1024 is 64 ms at 16 kHz and
  // only 11 ms at 96 kHz. Sized from the real rate, it is always over 30 ms.
  const CHUNK = Math.max(1024, Math.ceil(ctx.sampleRate * 0.032));
  let pending = new Int16Array(CHUNK);
  let pendingLength = 0;
  let pendingAtMs = 0;
  let pendingPeak = 0;

  const emit = () => {
    if (pendingLength === 0) return;
    onFrame({ pcm: pending.slice(0, pendingLength), rms: pendingPeak, atMs: pendingAtMs });
    pending = new Int16Array(CHUNK);
    pendingLength = 0;
    pendingPeak = 0;
  };

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (!gateOpen) return;

    const float = event.data;
    const atMs = (samples / ctx.sampleRate) * 1000;
    samples += float.length;

    // One loudness reading per worklet frame, on the same timeline the
    // transcript's word times use.
    let sumSquares = 0;
    for (let i = 0; i < float.length; i++) sumSquares += float[i] * float[i];
    const rms = Math.sqrt(sumSquares / float.length);
    track.push({ atMs, rms });
    heard.push(rms);

    if (pendingLength === 0) pendingAtMs = atMs;
    if (rms > pendingPeak) pendingPeak = rms;

    for (let i = 0; i < float.length; i++) {
      const s = Math.max(-1, Math.min(1, float[i]));
      pending[pendingLength++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (pendingLength === CHUNK) emit();
    }
  };

  source.connect(node);
  // An AudioWorkletNode that goes nowhere is allowed to be garbage collected in
  // some engines; a muted gain node keeps it alive without echoing the mic.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination);

  return {
    sampleRate: ctx.sampleRate,

    elapsedMs: () => (samples / ctx.sampleRate) * 1000,

    reset() {
      samples = 0;
      track = [];
    },

    open() {
      gateOpen = true;
    },

    close() {
      // The part-filled chunk belongs to this turn — send it before the caller
      // asks for the turn to end, or the tail of the last word is lost.
      emit();
      gateOpen = false;
    },

    loudnessBetween(startMs, endMs) {
      let peak = 0;
      for (const point of track) {
        if (point.atMs < startMs) continue;
        if (point.atMs > endMs) break;
        if (point.rms > peak) peak = point.rms;
      }
      return peak;
    },

    baseline() {
      const spoken = heard.filter((rms) => rms > 0.01);
      if (spoken.length === 0) return 0.05;
      const sorted = [...spoken].sort((a, b) => a - b);
      // Median of the frames that had any sound in them. Robust against both
      // the silence between words and one loud cough.
      return sorted[Math.floor(sorted.length / 2)];
    },

    stop() {
      gateOpen = false;
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
