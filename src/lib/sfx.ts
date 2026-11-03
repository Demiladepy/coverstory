/**
 * The noises the house makes.
 *
 * All synthesised — there is not a single audio file in this project, and
 * there does not need to be. A knock is a short burst of noise with the high
 * end taken off and a body under it; the meter landing is a low tone that
 * falls. Both are a few oscillators and an envelope.
 *
 * Papers, Please withholds its music until the moment you are judged, so that
 * when it arrives it means something. The same idea, smaller: the game is
 * silent except for voices, so the two sounds that do exist carry weight —
 * someone is at the door, and they believed you less than they did a moment
 * ago.
 *
 * Kept deliberately quiet. The voices are the point; these sit underneath.
 */

let muted = false;

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

/** One reusable second of white noise — the raw material for the knock. */
let noise: AudioBuffer | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const frames = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

/** One rap on a wooden door: a knock is mostly a transient, so it is short. */
function rap(ctx: AudioContext, at: number, level: number) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);

  // Wood resonates low and the rest dies instantly; a bandpass does most of
  // the work of making noise sound like a door rather than a hiss.
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 260;
  band.Q.value = 1.1;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);

  source.connect(band).connect(gain).connect(ctx.destination);
  source.start(at);
  source.stop(at + 0.14);

  // A little body under it, so it lands in the chest rather than the ear.
  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(96, at);
  thump.frequency.exponentialRampToValueAtTime(58, at + 0.09);

  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0, at);
  thumpGain.gain.linearRampToValueAtTime(level * 0.8, at + 0.006);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);

  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(at);
  thump.stop(at + 0.16);
}

/** Someone is at the door. Three raps, unevenly spaced, because people are. */
export function knock(ctx: AudioContext) {
  if (muted) return;
  const now = ctx.currentTime + 0.05;
  rap(ctx, now, 0.5);
  rap(ctx, now + 0.17, 0.44);
  rap(ctx, now + 0.31, 0.38);
}

/**
 * One rap, softer, when the house has gone quiet for too long.
 *
 * Not a warning noise — a person on a doorstep, wondering whether anyone
 * heard them. It says the same thing the draining bar says, for anyone who is
 * listening rather than looking.
 */
export function nudge(ctx: AudioContext) {
  if (muted) return;
  rap(ctx, ctx.currentTime + 0.03, 0.3);
}

/**
 * The meter landing.
 *
 * Up is a tone that falls — the sound of something settling against you.
 * Down is the same shape inverted and quieter, because being believed should
 * be a relief rather than a reward chime.
 */
export function meterMoved(ctx: AudioContext, delta: number) {
  if (muted || delta === 0) return;

  const up = delta > 0;
  const now = ctx.currentTime + 0.02;
  // A big swing should sound bigger, but not four times bigger.
  const weight = Math.min(1, Math.abs(delta) / 26);

  const tone = ctx.createOscillator();
  tone.type = up ? "triangle" : "sine";

  const from = up ? 220 : 330;
  const to = up ? 110 : 440;
  tone.frequency.setValueAtTime(from, now);
  tone.frequency.exponentialRampToValueAtTime(to, now + (up ? 0.5 : 0.22));

  const gain = ctx.createGain();
  const peak = (up ? 0.13 : 0.05) * (0.45 + weight * 0.55);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (up ? 0.62 : 0.3));

  tone.connect(gain).connect(ctx.destination);
  tone.start(now);
  tone.stop(now + (up ? 0.7 : 0.36));
}
