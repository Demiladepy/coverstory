/**
 * The event contract. Frozen, the UI renders these and nothing else.
 *
 * Everything the player sees is a reduction over this stream: the house scene,
 * the suspicion meter, the caption track, the replay. The game engine emits
 * them for real; `mock.ts` emits the same shapes on a timer so screens can be
 * built and styled before the real loop works.
 */

export type VoiceId = "dad" | "mom" | "uncle";
export type Speaker = VoiceId | "visitor" | "kid";

/** One word of synthesised speech, timed against the start of its own clip. */
export type WordTiming = {
  text: string;
  /** ms from the start of this line's audio */
  start: number;
  /** ms from the start of this line's audio */
  end: number;
};

/** Why the meter moved. Scored in code, never by the model's mood. */
export type SuspicionReason =
  | "dead_air"
  | "contradiction"
  | "wrong_voice"
  | "kid_slip"
  | "evasive"
  | "confident_answer"
  | "consistent_answer"
  | "excuse_landed"
  | "excuse_misfired";

export type LevelId = "pizza" | "neighbour" | "school" | "boss";

export type LevelResult = "won" | "caught";

/**
 * One line written during prep and parked on a hotkey.
 *
 * The voice is chosen when the line is written, not when it is fired. Deciding
 * *who* says a thing is most of the work of preparing an excuse, and doing it
 * in advance is the whole advantage the prep phase buys: at the door the player
 * presses one key and a complete, fluent answer comes out in the right voice,
 * with none of the hesitation a live reply carries.
 */
export type Excuse = { text: string; voice: VoiceId };

/** A thing an adult has claimed out loud. The visitor brain remembers these. */
export type Claim = {
  /** who said it */
  voice: VoiceId;
  /** the sentence as spoken */
  text: string;
  /** which level it was said in, claims carry across levels */
  level: LevelId;
  at: number;
};

export type GameEvent =
  /** A level is starting. Fires before the visitor's first line so the UI can
   *  play the intro while the TTS session opens behind it. */
  | {
      type: "level_start";
      level: LevelId;
      /** "Pizza driver, 8 p.m." */
      brief: string;
      visitorName: string;
      /** what they want, in the visitor's own words */
      want: string;
      at: number;
    }
  /** The prep phase: write up to three excuse lines onto keys 7, 8 and 9. */
  | {
      type: "prep_start";
      level: LevelId;
      slots: 3;
      secondsAllowed: number;
      at: number;
    }
  | {
      type: "prep_end";
      level: LevelId;
      /** index 0..2 maps to keys 7, 8, 9; blank text means the slot is unused */
      excuses: Excuse[];
      at: number;
    }
  /** The visitor speaks. Audio is already playing when this lands. */
  | {
      type: "visitor_line";
      id: string;
      text: string;
      timings: WordTiming[];
      /** total clip length in ms */
      durationMs: number;
      /** the visitor is addressing a specific adult, or nobody in particular */
      addressedTo: VoiceId | null;
      /**
       * How far into the clip its audio already is when this event lands.
       *
       * The word timings only arrive once the whole response has been read,
       * by which point the voice has been talking for a moment. Without this
       * the captions would start from the top while the ear is already three
       * words in, and the lit word would trail the voice for the whole line.
       */
      playbackOffsetMs: number;
      at: number;
    }
  /** The player held a key and spoke; this is the line as the house heard it. */
  | {
      type: "player_line";
      id: string;
      /** what the realtime transcript heard, hesitations and all */
      text: string;
      /** the same text after shout-to-CAPS and punctuation shaping */
      spokenText: string;
      voice: VoiceId;
      timings: WordTiming[];
      durationMs: number;
      /** the words the player raised their voice on, as the shout shaper found them */
      shouted: string[];
      /** how far into the clip its audio already is when this event lands */
      playbackOffsetMs: number;
      /** true when this line was fired from an excuse hotkey, not the mic */
      fromExcuseSlot: number | null;
      at: number;
    }
  /** The meter moved. `value` is absolute 0..100, not a delta. */
  | {
      type: "suspicion";
      value: number;
      delta: number;
      reasons: { reason: SuspicionReason; points: number; detail?: string }[];
      at: number;
    }
  /** Push-to-talk state, so the UI can show the key is live. */
  | {
      type: "mic_state";
      state: "idle" | "listening" | "finalising";
      /** live partial transcript while listening */
      partial?: string;
      /**
       * How loud the player is right now, 0..1, and how loud they usually are.
       *
       * Both, because loudness on its own means nothing: the game scores a
       * shout against the speaker's own normal level, so the only honest way
       * to show it is to show where their normal sits. Without this the whole
       * shout mechanic is invisible and nobody discovers it.
       */
      level?: number;
      baseline?: number;
      /**
       * How long the house can stay quiet before the visitor starts to wonder,
       * sent when the floor becomes the player's.
       *
       * Dead air was the one pressure with no tell: seven seconds of nothing
       * and the meter moved, with the first notice being the penalty itself.
       * A rule you only learn by being punished by it reads as unfair rather
       * than hard.
       */
      graceMs?: number;
      at: number;
    }
  | {
      type: "level_end";
      level: LevelId;
      result: LevelResult;
      suspicion: number;
      /** how long the encounter ran, ms */
      elapsedMs: number;
      at: number;
    }
  /** The whole run is over; the replay can be assembled from the log. */
  | {
      type: "run_end";
      result: LevelResult;
      levelsCleared: number;
      at: number;
    }
  /** Something broke. The UI shows a retry path, never a stack trace. */
  | {
      type: "error";
      code: "mic_denied" | "stt_lost" | "tts_failed" | "brain_failed" | "budget" | "unknown";
      message: string;
      recoverable: boolean;
      at: number;
    };

export type GameEventType = GameEvent["type"];

/** One spoken line's audio, exactly as it was played. */
export type Clip = { pcm: Int16Array; sampleRate: number };

/**
 * The replay is the event log plus the audio, keyed by line id.
 *
 * The audio is kept as raw samples rather than blobs so the whole encounter can
 * be stitched into one file at the end without asking the service for any of it
 * again, the player hears exactly what they heard the first time.
 */
export type RunLog = {
  startedAt: number;
  events: GameEvent[];
  clips: Map<string, Clip>;
};

export const MAX_SUSPICION = 100;
export const VOICE_KEYS: Record<string, VoiceId> = { "1": "dad", "2": "mom", "3": "uncle" };
export const EXCUSE_KEYS = ["7", "8", "9"] as const;
export const EXCUSE_SLOTS = 3;
/** Long enough to think of three lines, short enough that you don't draft them. */
export const PREP_SECONDS = 45;

export const VOICE_LABEL: Record<VoiceId, string> = {
  dad: "Dad",
  mom: "Mom",
  uncle: "Uncle",
};
