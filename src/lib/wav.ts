/**
 * Turning the run back into a file.
 *
 * Every line the house and the visitor spoke arrives as raw PCM and is kept,
 * so the whole encounter can be stitched back together without asking the
 * service for any of it again. The result is a WAV because a WAV plays
 * everywhere, with no player and no page, which is the point of a share.
 */

import type { Clip } from "@/lib/events";

/** Linear resample. Crude, and fine for speech at a ratio near 1. */
function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const ratio = from / to;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, pcm.length - 1);
    const t = at - low;
    out[i] = pcm[low] * (1 - t) + pcm[high] * t;
  }
  return out;
}

/**
 * Lay the clips end to end with a breath between them.
 *
 * The gaps matter: played back-to-back the conversation sounds like one person
 * talking over themselves, and the whole joke is that it is two people who are
 * not there.
 */
export function stitch(clips: Clip[], gapMs = 420): Clip {
  const usable = clips.filter((c) => c.pcm.length > 0);
  if (usable.length === 0) return { pcm: new Int16Array(0), sampleRate: 24000 };

  const sampleRate = usable[0].sampleRate;
  const parts = usable.map((c) => resample(c.pcm, c.sampleRate, sampleRate));
  const gap = Math.round((gapMs / 1000) * sampleRate);

  const total = parts.reduce((n, p) => n + p.length, 0) + gap * (parts.length - 1);
  const out = new Int16Array(total);

  let offset = 0;
  parts.forEach((part, i) => {
    out.set(part, offset);
    offset += part.length + (i < parts.length - 1 ? gap : 0);
  });

  return { pcm: out, sampleRate };
}

export function encodeWav({ pcm, sampleRate }: Clip): Blob {
  const bytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, bytes, true);

  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
}

/** Schedule one clip on a context and report when it will have finished. */
export function playClip(ctx: AudioContext, clip: Clip, atTime: number): number {
  const buffer = ctx.createBuffer(1, clip.pcm.length, clip.sampleRate);
  buffer.copyToChannel(Float32Array.from(clip.pcm, (s) => s / 32768), 0);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(atTime);
  return atTime + buffer.duration;
}
