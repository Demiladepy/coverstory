/**
 * The suspicion meter.
 *
 * Everything here is pure: facts in, points out. No model call, no clock, no
 * audio. That is deliberate — a meter you cannot test is a meter you cannot
 * tune, and this one has to be tuned by playing.
 *
 * The split between what is scored here and what is asked of the model comes
 * out of the spike (docs/SPIKE-FINDINGS.md). Models blur these categories when
 * they only see text: the one we tested read a reply full of hesitation as
 * childish rather than evasive, which is a fair reading and a useless signal.
 * The code does not have to guess, because it can hear the hesitation, time the
 * gaps and compare the loudness against how this player normally sounds.
 *
 * So: six signals, five of them measured here. Only contradiction goes to the
 * model, because only contradiction needs memory and meaning.
 */

import type { SttWord } from "@/lib/stt";
import type { SuspicionReason, VoiceId } from "@/lib/events";

export const START_SUSPICION = 10;
export const CAUGHT_AT = 100;

/** How long the house can stay silent before the visitor starts to wonder. */
export const DEAD_AIR_GRACE_MS = 7000;
export const DEAD_AIR_POINTS = 12;

const POINTS: Record<SuspicionReason, number> = {
  contradiction: 26,
  wrong_voice: 18,
  kid_slip: 14,
  dead_air: DEAD_AIR_POINTS,
  excuse_misfired: 12,
  evasive: 10,
  consistent_answer: -5,
  confident_answer: -8,
  excuse_landed: -10,
};

export const FILLER = /\b(uh+|um+|erm|er|ah+|hmm+|mhm|huh|like|y'?know)\b/gi;

/**
 * Things a twelve-year-old says and a grown-up does not.
 *
 * Deliberately narrow. A broad list punishes ordinary speech and the player
 * never learns what tripped it; these are tells you can hear yourself making.
 */
const KID_TELLS: { pattern: RegExp; tell: string }[] = [
  { pattern: /\bmy (mom|mum|mummy|dad|daddy|parents)\b/i, tell: "called them your parents" },
  { pattern: /\b(i'?m not allowed|i have to ask|i'?m supposed to)\b/i, tell: "asked permission" },
  { pattern: /\b(my teacher|homework|recess|my class|school tomorrow)\b/i, tell: "school talk" },
  { pattern: /\b(grown[- ]?ups?|a grown[- ]?up)\b/i, tell: "said grown-up" },
  { pattern: /\bi'?m (only )?(ten|eleven|twelve|thirteen|a kid)\b/i, tell: "gave your age" },
  { pattern: /\b(can i go|am i in trouble|please don'?t tell)\b/i, tell: "asked like a kid" },
];

const DODGES =
  /\b(dunno|don'?t know|no idea|whatever|not sure|i guess|ask (him|her|them)|come back later|busy right now)\b/i;

/** Words, ignoring the noises between them. */
function contentWords(text: string): string[] {
  return text
    .replace(FILLER, " ")
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w));
}

export function fillerRatio(text: string): number {
  const total = text.split(/\s+/).filter(Boolean).length;
  if (total === 0) return 0;
  return (text.match(FILLER) ?? []).length / total;
}

/** The longest silence inside the answer, in ms. Hesitation you can hear. */
export function longestGapMs(words: SttWord[]): number {
  let longest = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > longest) longest = gap;
  }
  return longest;
}

export function meanConfidence(words: SttWord[]): number {
  if (words.length === 0) return 1;
  return words.reduce((sum, w) => sum + (w.confidence ?? 1), 0) / words.length;
}

export type TurnFacts = {
  /** what the transcript heard, hesitations and all */
  transcript: string;
  words: SttWord[];
  /** which grown-up answered — the key that was held */
  voice: VoiceId;
  /** who the visitor was addressing, if anyone in particular */
  askedFor: VoiceId | null;
  /** the visitor's last line, so a question can be told from a remark */
  visitorSaid: string;
  /** the player's own normal loudness */
  baseline: number;
  loudnessBetween: (startMs: number, endMs: number) => number;
  /** the model's one judgement, or null when it was not asked */
  contradiction: { found: boolean; detail?: string } | null;
  /** how many things the adults have already claimed out loud */
  priorClaims: number;
};

export type ScoredReason = { reason: SuspicionReason; points: number; detail?: string };
export type Scored = { delta: number; reasons: ScoredReason[] };

export function scoreTurn(facts: TurnFacts): Scored {
  const reasons: ScoredReason[] = [];
  const add = (reason: SuspicionReason, detail?: string) =>
    reasons.push({ reason, points: POINTS[reason], detail });

  const words = contentWords(facts.transcript);
  const fillers = fillerRatio(facts.transcript);
  const gap = longestGapMs(facts.words);
  const confidence = meanConfidence(facts.words);

  // Answering in the wrong voice. The visitor asked for someone by name and
  // somebody else spoke up — the single most obvious way to be caught.
  if (facts.askedFor && facts.askedFor !== facts.voice) {
    add("wrong_voice", `they were asking for ${facts.askedFor}`);
  }

  // Contradiction is the model's only job, and it is the heaviest hit.
  if (facts.contradiction?.found) {
    add("contradiction", facts.contradiction.detail);
  } else if (facts.contradiction && facts.priorClaims >= 2) {
    // Holding a story together across several claims is worth something.
    add("consistent_answer", "the story still holds");
  }

  const tell = KID_TELLS.find((t) => t.pattern.test(facts.transcript));
  if (tell) {
    add("kid_slip", tell.tell);
  } else if (confidence < 0.55 && facts.words.length >= 3) {
    // Not a word choice — a voice that wavered enough that the transcript
    // itself was unsure. A grown-up at their own door does not mumble.
    add("kid_slip", "it came out mumbled");
  }

  // Evasion: not answering a question that was actually put to you. A long
  // pause counts here too — stalling and dodging look the same from the step.
  const wasAsked = /\?\s*$/.test(facts.visitorSaid.trim());
  if (wasAsked) {
    if (words.length < 3) add("evasive", "barely an answer");
    else if (fillers > 0.22) add("evasive", "more hesitation than answer");
    else if (DODGES.test(facts.transcript) && words.length < 12) add("evasive", "brushed it off");
    else if (gap > 1200) add("evasive", "left a long pause");
  }

  // Conviction. Few fillers, no long silence, and spoken at or above your own
  // normal level — the three things that make a stranger believe you.
  //
  // Only awarded when nothing else went wrong. Saying a slip confidently is
  // not a partial save; it is a confident slip, and letting it claw back most
  // of the damage would teach the player that volume beats keeping the story
  // straight.
  const alreadyCaught = reasons.some((r) => r.points > 0);
  const loud = facts.words.length
    ? facts.words.reduce((sum, w) => sum + facts.loudnessBetween(w.start, w.end), 0) /
      facts.words.length
    : 0;
  const steady = fillers < 0.09 && gap < 700 && words.length >= 4;
  if (!alreadyCaught && steady && facts.baseline > 0 && loud >= facts.baseline * 0.95) {
    add("confident_answer", "said it like you meant it");
  }

  return { delta: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

export type ExcuseFacts = {
  /** the voice the line was written for */
  voice: VoiceId;
  askedFor: VoiceId | null;
  contradiction: { found: boolean; detail?: string } | null;
  priorClaims: number;
  /** this slot has already been spent in this encounter */
  reused: boolean;
};

/**
 * A prepared line is scored differently, because there is nothing to hear.
 *
 * None of the live signals exist: no fillers, no pauses, no loudness, because
 * the player did not speak. That is exactly the trade the prep phase offers —
 * a canned line is perfectly fluent and arrives instantly, so it cannot give
 * you away the way your own voice can.
 *
 * What it can do is fail to fit. It was written before the question was asked,
 * so it can be the wrong voice, it can contradict what the house already said,
 * and — the one failure unique to it — it can be a line the visitor has already
 * heard. Saying the same sentence twice is the most obvious tell there is.
 */
export function scoreExcuse(facts: ExcuseFacts): Scored {
  const reasons: ScoredReason[] = [];
  const add = (reason: SuspicionReason, detail?: string) =>
    reasons.push({ reason, points: POINTS[reason], detail });

  if (facts.askedFor && facts.askedFor !== facts.voice) {
    add("wrong_voice", `they were asking for ${facts.askedFor}`);
  }
  if (facts.contradiction?.found) add("contradiction", facts.contradiction.detail);
  if (facts.reused) add("excuse_misfired", "they have heard that one already");

  if (!reasons.some((r) => r.points > 0)) {
    add("excuse_landed", "ready before they finished asking");
  }

  return { delta: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

export function deadAir(): Scored {
  return {
    delta: DEAD_AIR_POINTS,
    reasons: [{ reason: "dead_air", points: DEAD_AIR_POINTS, detail: "nobody answered" }],
  };
}

/** Plain English for the meter's little ticker. */
export const REASON_LABEL: Record<SuspicionReason, string> = {
  dead_air: "Silence",
  contradiction: "Doesn't add up",
  wrong_voice: "Wrong voice",
  kid_slip: "Sounded twelve",
  evasive: "Dodged it",
  confident_answer: "Convincing",
  consistent_answer: "Story holds",
  excuse_landed: "Excuse landed",
  excuse_misfired: "Excuse misfired",
};
