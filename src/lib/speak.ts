/**
 * Re-voicing the player over HTTP.
 *
 * `/v1/speech/events` is the only TTS route that returns audio *and* word
 * timings in one call, which is what the captioned replay needs. It answers
 * server-sent events: Begin, Audio (base64 raw PCM), FlushDone,
 * WordBoundaries, Termination.
 *
 * The browser calls it directly with a short-lived token, so the player's line
 * doesn't make a round trip through our server on the way to being spoken. One
 * request per line, which is also what keeps us under the HTTP rate limit
 * rather than the much tighter new-session-per-minute limit.
 */

import type { WordTiming } from "@/lib/events";

export type SpokenLine = {
  /** ms from the request leaving to the first audio being scheduled */
  firstAudioMs: number;
  /** ms from the request leaving to the last byte arriving */
  completeMs: number;
  durationMs: number;
  timings: WordTiming[];
  /** the whole line as PCM, kept so the replay can mix it later */
  pcm: Int16Array;
  sampleRate: number;
  /** AudioContext time the first buffer was scheduled at */
  startedAt: number;
};

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Speak one line and play it as it arrives.
 *
 * `onFirstAudio` fires the moment the first buffer is scheduled — that is the
 * number the whole game is designed around, so it is reported separately
 * rather than inferred from when this promise settles.
 */
export async function speakLine(opts: {
  ctx: AudioContext;
  token: string;
  text: string;
  voiceId: string;
  signal?: AbortSignal;
  onFirstAudio?: (elapsedMs: number) => void;
}): Promise<SpokenLine> {
  const { ctx, token, text, voiceId, signal } = opts;
  const started = performance.now();

  const res = await fetch("https://tts.us.assemblyai.com/v1/speech/events", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId, language: "english" }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`speech failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  let sampleRate = 24000;
  let firstAudioMs = -1;
  let startedAt = 0;
  let playHead = 0;
  let durationMs = 0;
  let timings: WordTiming[] = [];
  let audioStartMs = 0;

  const pieces: Uint8Array[] = [];
  let carry = new Uint8Array(0);

  const schedule = (bytes: Uint8Array) => {
    // Only whole 16-bit samples; the tail waits for the next event.
    const joined = new Uint8Array(carry.length + bytes.length);
    joined.set(carry);
    joined.set(bytes, carry.length);
    const whole = joined.length & ~1;
    carry = joined.slice(whole);
    if (whole === 0) return;

    const pcm = new Int16Array(joined.buffer, 0, whole / 2);
    pieces.push(new Uint8Array(joined.buffer.slice(0, whole)));

    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(Float32Array.from(pcm, (s) => s / 32768), 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    if (firstAudioMs < 0) {
      firstAudioMs = performance.now() - started;
      startedAt = ctx.currentTime + 0.04;
      playHead = startedAt;
      opts.onFirstAudio?.(firstAudioMs);
    }

    playHead = Math.max(playHead, ctx.currentTime);
    source.start(playHead);
    playHead += buffer.duration;
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let event = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith(":") || line.trim() === "") continue;

      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ")) continue;

      const data = JSON.parse(line.slice(6)) as Record<string, never>;

      switch (event) {
        case "Begin": {
          const configuration = (data.configuration ?? {}) as Record<string, number>;
          if (configuration.sample_rate) sampleRate = Number(configuration.sample_rate);
          break;
        }
        case "Audio":
          schedule(decodeBase64(String(data.audio)));
          break;
        case "FlushDone":
          durationMs = Number(data.audio_duration_ms ?? 0);
          break;
        case "WordBoundaries": {
          audioStartMs = Number(data.audio_start_ms ?? 0);
          const words = (data.words ?? []) as unknown as {
            word: string; start: number; end: number;
          }[];
          // Times are on the session's timeline; subtract the request's own
          // offset to place a word inside this line. Never add it.
          timings = words
            .filter((w) => w.end > w.start)
            .map((w) => ({
              text: w.word,
              start: w.start - audioStartMs,
              end: w.end - audioStartMs,
            }));
          break;
        }
        case "Error":
          throw new Error(`speech error: ${String(data.message ?? data.error ?? "unknown")}`);
      }
    }
  }

  const total = pieces.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }

  return {
    firstAudioMs: firstAudioMs < 0 ? performance.now() - started : firstAudioMs,
    completeMs: performance.now() - started,
    durationMs,
    timings,
    pcm: new Int16Array(joined.buffer, 0, joined.length / 2),
    sampleRate,
    startedAt,
  };
}
