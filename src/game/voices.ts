import type { VoiceId } from "@/lib/events";

/**
 * Casting.
 *
 * The three grown-ups are on the critical path, the player lets go of the key
 * and an adult has to answer *now*, so they use built-in voices, which the
 * model always has loaded. Any other catalog voice is loaded on first use and
 * the first line after a cold start waits noticeably longer.
 *
 * Visitors are the opposite case: their TTS session opens while the level
 * intro is still playing, so they can afford a characterful catalog voice.
 */

export type Grownup = {
  id: VoiceId;
  label: string;
  /** hotkey that selects this voice */
  key: "1" | "2" | "3";
  voiceId: string;
  /** what the player should hear in their head when they pick it */
  note: string;
};

/**
 * Cast on measured speed, not on how they sound, these still need an audition.
 * Median time to first audio over three runs each (scripts/probe.mjs):
 * charles 254 ms, george 269 ms, jean 284 ms, michael 328 ms, paul 689 ms.
 * Paul is erratic (1224/689/250) despite being built in, so Dad, the voice
 * players reach for first, is Charles instead.
 */
export const GROWNUPS: Grownup[] = [
  { id: "dad", label: "Dad", key: "1", voiceId: "aai-charles", note: "tired, flat, wants this over with" },
  { id: "mom", label: "Mom", key: "2", voiceId: "aai-mary", note: "warm, a little too helpful" },
  { id: "uncle", label: "Uncle", key: "3", voiceId: "aai-george", note: "loud, overfamiliar, unreliable" },
];

export const GROWNUP_BY_ID: Record<VoiceId, Grownup> = Object.fromEntries(
  GROWNUPS.map((g) => [g.id, g]),
) as Record<VoiceId, Grownup>;

/** Candidates to audition for the four visitors. */
export const VISITOR_VOICES = {
  pizza: "aai-ewald",
  neighbour: "aai-lilla",
  school: "aai-audrey",
  boss: "aai-dorsey",
} as const;
