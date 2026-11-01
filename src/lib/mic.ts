/**
 * Mic capture: 16 kHz mono PCM16 frames for the STT socket, plus a loudness
 * track alongside them.
 *
 * The loudness track is not instrumentation. The STT words come back with
 * start/end times on the session's audio timeline, and this track is on the
 * same timeline, so a word can be looked up by when it was said and scored for
 * how hard it was said. That is what turns a shout into CAPS in the adult's
 * mouth — cheap, and the moment people laugh.
 */

export type MicFrame = { pcm: Int16Array; rms: number; atMs: number };

export type Mic = {
  /** ms of audio captured since the session started */
  elapsedMs: () => number;
  /**
   * Push whatever is still buffered. Call this before ForceEndpoint or the
   * last fraction of a second — often the end of the last word — never
   * reaches the transcript.
   */
  flush: () => void;
  /** peak loudness between two points on the session timeline, 0..1 */
  loudnessBetween: (startMs: number, endMs: number) => number;
  /** loudness over the whole capture so far, used as the speaker's baseline */
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

  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume();

  const blob = new Blob([WORKLET], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture");

  let samples = 0;
  const track: { atMs: number; rms: number }[] = [];

  // A worklet hands us 128 samples at a time — 8 ms at 16 kHz — and the
  // transcript socket refuses anything under 20 ms. So the PCM is batched into
  // chunks before it goes out. The loudness track is not batched: it stays at
  // the worklet's own resolution, because a shout is a short, sharp thing and
  // 64 ms buckets would smear it away.
  const CHUNK = 1024; // 64 ms at 16 kHz
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
    const float = event.data;
    const atMs = (samples / ctx.sampleRate) * 1000;
    samples += float.length;

    // One loudness reading per worklet frame, on the same timeline the
    // transcript's word times use.
    let sumSquares = 0;
    for (let i = 0; i < float.length; i++) sumSquares += float[i] * float[i];
    const rms = Math.sqrt(sumSquares / float.length);
    track.push({ atMs, rms });

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
    elapsedMs: () => (samples / ctx.sampleRate) * 1000,

    flush: emit,

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
      const spoken = track.filter((p) => p.rms > 0.01);
      if (spoken.length === 0) return 0.05;
      const sorted = spoken.map((p) => p.rms).sort((a, b) => a - b);
      // Median of the frames that had any sound in them. Robust against both
      // the silence between words and one loud cough.
      return sorted[Math.floor(sorted.length / 2)];
    },

    stop() {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
