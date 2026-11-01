import type { LevelId, VoiceId } from "@/lib/events";
import { VISITOR_VOICES } from "@/game/voices";

/**
 * The four encounters.
 *
 * Each one carries its own opening line, written out rather than generated.
 * That is not laziness — it means the level starts the instant the player
 * presses go, with no model round trip between the door knock and the first
 * voice. Every line after the first is the model's.
 */

export type Level = {
  id: LevelId;
  /** the card shown while the level opens: "Pizza driver · 8 p.m." */
  brief: string;
  visitorName: string;
  /** what they want, in their own words, shown to the player */
  want: string;
  voiceId: string;
  /** who they expect to be talking to, if anyone in particular */
  expects: VoiceId | null;
  /** the first thing out of their mouth */
  opener: string;
  /** how they behave, handed to the model as its character */
  persona: string;
  /** survive this many of their questions and the level is won */
  turnsToWin: number;
};

export const LEVELS: Level[] = [
  {
    id: "pizza",
    brief: "Pizza driver · 8 p.m.",
    visitorName: "the driver",
    want: "someone over eighteen to take the order",
    voiceId: VISITOR_VOICES.pizza,
    expects: null,
    opener: "Evening! Large pepperoni, two garlic breads. I just need an adult to sign for it.",
    persona:
      "A pizza delivery driver at the door, running late and wanting to get back to the car. " +
      "Friendly, fast, a bit bored. You need an adult to sign. You are not suspicious by nature, " +
      "but you have been burned before by kids ordering on a parent's card, so if something feels " +
      "off you ask one plain question about it.",
    turnsToWin: 3,
  },
  {
    id: "neighbour",
    brief: "Nosy neighbour · just after nine",
    visitorName: "Mrs. Okafor from next door",
    want: "to check an adult is actually home",
    voiceId: VISITOR_VOICES.neighbour,
    expects: "mom",
    opener:
      "Sorry to knock so late — I saw the lights on and I haven't seen your mother's car all week. Is she in?",
    persona:
      "The neighbour from next door, middle-aged, warm on the surface and nosy underneath. " +
      "You ask after people by name. You notice things — cars, bins, curtains — and you mention " +
      "what you noticed. You are not hostile, you are interested, which is worse.",
    turnsToWin: 4,
  },
  {
    id: "school",
    brief: "School office · on the phone",
    visitorName: "the school office",
    want: "a parent to explain this morning's absence",
    voiceId: VISITOR_VOICES.school,
    expects: "dad",
    opener:
      "Good afternoon, this is the attendance office. I'm calling about this morning. Am I speaking with a parent or guardian?",
    persona:
      "A school attendance officer on the phone. Procedural, patient, and completely unbothered " +
      "by silence. You work from a script and you will repeat a question you did not get an " +
      "answer to. You ask for names, dates and spellings, because that is the job.",
    turnsToWin: 4,
  },
  {
    id: "boss",
    brief: "Christmas Eve · the relatives are here",
    visitorName: "Aunt Bisi and the whole carload",
    want: "to come in, see everyone, and stay",
    voiceId: VISITOR_VOICES.boss,
    expects: "uncle",
    opener:
      "We're here! Open up — I've got the cooler, your uncle's right behind me. Where is everybody?",
    persona:
      "An aunt arriving for Christmas with a carload of family, loud and delighted and already " +
      "halfway through the door. You address different people by name in the same breath and " +
      "expect each of them to answer. You remember what this family told you last year and you " +
      "bring it up. You do not take a hint.",
    turnsToWin: 5,
  },
];

export const LEVEL_BY_ID: Record<LevelId, Level> = Object.fromEntries(
  LEVELS.map((l) => [l.id, l]),
) as Record<LevelId, Level>;
