import type { SttWord } from "@/lib/stt";

/**
 * Turning a raised voice into a raised voice.
 *
 * The transcript gives each word a position on the audio timeline; the mic's
 * loudness track is on that same timeline. So a word can be looked up by when
 * it was said and asked how hard it was said. Words above the player's own
 * normal level come out in CAPS, and the TTS leans on them, measured at 25%
 * longer on the same sentence, which is the whole joke.
 *
 * The threshold is against the speaker's own baseline rather than an absolute
 * level, because a quiet player in a quiet room should still be able to shout.
 */

/** How far above their own normal a word has to be to count as shouted. */
export const SHOUT_RATIO = 1.7;

export type Shaped = {
  /** what gets sent to the TTS */
  text: string;
  /** which words came out loud, for the suspicion score to read later */
  shouted: string[];
};

export function shapeForSpeech(
  transcript: string,
  words: SttWord[],
  loudnessBetween: (startMs: number, endMs: number) => number,
  baseline: number,
): Shaped {
  if (words.length === 0 || baseline <= 0) return { text: transcript, shouted: [] };

  const threshold = baseline * SHOUT_RATIO;
  const shouted: string[] = [];

  const spoken = words.map((word) => {
    const peak = loudnessBetween(word.start, word.end);
    if (peak <= threshold) return word.text;
    shouted.push(word.text);
    return word.text.toUpperCase();
  });

  let text = spoken.join(" ");

  // A line that ends loud ends on an exclamation, so the voice carries the
  // shape of it past the last word.
  const endedLoud = shouted.includes(words[words.length - 1].text);
  if (endedLoud && !/[!?]$/.test(text)) text = text.replace(/[.\s]*$/, "") + "!";

  return { text, shouted };
}
