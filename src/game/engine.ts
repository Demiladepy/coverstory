/**
 * The core loop.
 *
 * A run is a night: several visitors in order, each one an encounter from the
 * knock to the door closing. The visitor speaks, the player holds a key and
 * answers, the answer comes back out of the house in a grown-up's voice, and
 * the visitor responds to what was actually said.
 *
 * What carries between encounters is the only thing that should: the claims.
 * Each visitor is a different person, so each gets a conversation of their own
 * and their own starting wariness — but everything an adult of this house has
 * ever said out loud stays on the record, and the thing you told the pizza
 * driver at eight is still true, or isn't, when the relatives arrive.
 *
 * The engine owns the hardware and the sockets and emits GameEvents. It knows
 * nothing about pixels — everything the player sees is a reduction over the
 * event stream, which is what lets the screen be built and restyled without
 * touching any of this.
 *
 * Two pieces of timing are load-bearing:
 *
 *  - The mic gate opens on key down and shuts on key up, so our audio clock and
 *    the transcript server's are the same clock. Word times then line up with
 *    the loudness track, which is what makes the shout trick possible at all.
 *  - The visitor's next line is written while the grown-up's line is still
 *    playing. The model costs about 1.5 s and a spoken answer runs longer than
 *    that, so the visitor is ready the moment the house goes quiet and the
 *    player never sits waiting on a model.
 */

import { startMic, type Mic } from "@/lib/mic";
import { openStt, type SttSession, type SttTurn, type SttWord } from "@/lib/stt";
import { speakLine, type SpokenLine } from "@/lib/speak";
import { GROWNUP_BY_ID } from "@/game/voices";
import { LEVEL_BY_ID } from "@/game/levels";
import { shapeForSpeech } from "@/game/shout";
import { knock, meterMoved, nudge } from "@/lib/sfx";
import {
  CAUGHT_AT,
  DEAD_AIR_GRACE_MS,
  deadAir,
  scoreExcuse,
  scoreTurn,
  type Scored,
  type TurnFacts,
} from "@/game/score";
import { EXCUSE_SLOTS, PREP_SECONDS } from "@/lib/events";
import type { Claim, Clip, Excuse, GameEvent, LevelId, RunLog, Speaker, VoiceId } from "@/lib/events";

export type Engine = {
  /** asks for the microphone, then opens the prep phase */
  start: () => Promise<void>;
  /** prep is over; the door knocks */
  submitPrep: (excuses: Excuse[]) => Promise<void>;
  /** a voice key went down */
  hold: (voice: VoiceId) => void;
  /** the voice key came up */
  release: () => void;
  /** an excuse hotkey was tapped */
  fire: (slot: number) => void;
  /** everything that happened, and everything that was said, for the replay */
  recording: () => RunLog;
  stop: () => void;
};

type ErrorCode = Extract<GameEvent, { type: "error" }>["code"];

type Line = {
  text: string;
  addressedTo: VoiceId | null;
  contradiction: { found: boolean; detail?: string } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function createEngine(opts: {
  /** the doors of this night, in order */
  levels: LevelId[];
  onEvent: (event: GameEvent) => void;
}): Engine {
  let levelIndex = 0;
  let level = LEVEL_BY_ID[opts.levels[0]];
  const runStart = performance.now();
  /** ms since the run began — every event is stamped on this one clock */
  const at = () => Math.round(performance.now() - runStart);

  let ctx: AudioContext | null = null;
  let mic: Mic | null = null;
  let stt: SttSession | null = null;
  let ttsToken = "";
  let sttToken = "";
  /** the night this engine is playing, as the token route knows it */
  let runId: string | null = null;

  let stopped = false;
  /** the house is quiet and the player may answer */
  let canSpeak = false;
  let holding = false;
  /** a release is out and we are waiting for its final turn */
  let awaiting = false;
  let heldVoice: VoiceId = "dad";
  /** the speaker's normal level, taken once as the key goes down */
  let holdBaseline = 0.05;
  let turnsSurvived = 0;
  let lines = 0;
  let suspicion = level.startSuspicion;
  /** this encounter is finished, one way or the other */
  let over = false;
  /** the whole night is finished */
  let runOver = false;

  /** who the visitor last asked for, and what they last said */
  let askedFor: VoiceId | null = null;
  let visitorSaid = "";
  let deadAirTimer: ReturnType<typeof setTimeout> | null = null;
  /** the single rap partway through the silence, before the penalty */
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  /** words from turns the model closed by itself, mid-hold */
  const carried = { text: "", words: [] as SttWord[] };
  /** this visitor's conversation — a new one at every door */
  let history: { speaker: Speaker; text: string }[] = [];
  /**
   * Everything an adult of this house has claimed out loud, all night.
   *
   * This is the only thing that crosses a doorstep. A new visitor has not
   * heard the last conversation, so the history resets; but the house has
   * still said what it said, and that is what contradiction is judged
   * against.
   */
  const claims: Claim[] = [];

  /** the three prepared lines, and which of them have been spent */
  let excuses: Excuse[] = [];
  const spent = new Set<number>();
  /** tokens and sockets, opened behind the prep screen */
  let setup: Promise<void> | null = null;

  /** the run as it happened, kept so the end of it can be played back */
  const journal: GameEvent[] = [];
  const clips = new Map<string, Clip>();

  const emit = (event: GameEvent) => {
    if (stopped) return;
    // mic_state is what the screen is doing right now, not what happened. The
    // replay is built from this journal, and a live level arrives fifteen
    // times a second, so it is reported and not recorded.
    if (event.type !== "mic_state") journal.push(event);
    opts.onEvent(event);
  };

  /**
   * Recoverable means the encounter can carry on. A failed line or a lost
   * socket is survivable; no microphone, no token and no opening line are not,
   * and pretending otherwise leaves the player staring at a screen that will
   * never change.
   */
  const fail = (code: ErrorCode, message: string, recoverable = true) =>
    emit({ type: "error", code, message, recoverable, at: at() });

  /**
   * Tokens for the door about to open.
   *
   * One night needs several, because each door gets its own transcript
   * session — a session bills for as long as its socket is open whether or not
   * anyone is talking, so holding one through four prep phases would bill
   * three minutes of somebody typing. The run id is what stops those refills
   * each counting as a fresh run against the hourly cap.
   */
  async function freshTokens() {
    const res = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runId ? { run: runId } : {}),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      fail(
        body.error === "budget" ? "budget" : "unknown",
        body.message ?? "could not start",
        false,
      );
      throw new Error("no tokens");
    }
    const tokens = (await res.json()) as { run: string; stt: string; tts: string };
    runId = tokens.run;
    ttsToken = tokens.tts;
    sttToken = tokens.stt;
  }

  async function play(text: string, voiceId: string) {
    const id = `l${lines++}`;
    const spoken = await speakLine({ ctx: ctx!, token: ttsToken, text, voiceId });
    clips.set(id, { pcm: spoken.pcm, sampleRate: spoken.sampleRate });
    return { id, spoken };
  }

  /** Come back when the house has gone quiet again. */
  async function waitOutAudio(spoken: SpokenLine) {
    if (!ctx) return;
    const endsAt = spoken.startedAt + spoken.durationMs / 1000;
    await sleep((endsAt - ctx.currentTime) * 1000);
  }

  async function visitorSays(line: Line) {
    const { id, spoken } = await play(line.text, level.voiceId);
    emit({
      type: "visitor_line",
      id,
      text: line.text,
      timings: spoken.timings,
      durationMs: spoken.durationMs,
      addressedTo: line.addressedTo,
      playbackOffsetMs: Math.max(0, (ctx!.currentTime - spoken.startedAt) * 1000),
      at: at(),
    });
    history.push({ speaker: "visitor", text: line.text });
    askedFor = line.addressedTo;
    visitorSaid = line.text;
    await waitOutAudio(spoken);
  }

  /**
   * Move the meter. Returns true when that was the end of it.
   *
   * The meter only ever moves here, with its reasons attached, so the screen
   * can always say why — a meter that climbs without telling you what you did
   * is a meter you cannot learn to play against.
   */
  function applyScore(scored: Scored): boolean {
    if (over) return true;
    suspicion = Math.max(0, Math.min(CAUGHT_AT, suspicion + scored.delta));
    if (ctx) meterMoved(ctx, scored.delta);
    emit({
      type: "suspicion",
      value: suspicion,
      delta: scored.delta,
      reasons: scored.reasons,
      at: at(),
    });

    if (suspicion >= CAUGHT_AT) {
      void endLevel("caught");
      return true;
    }
    return false;
  }

  /** A new door: fresh everything except what the house has already said. */
  function beginLevel() {
    level = LEVEL_BY_ID[opts.levels[levelIndex]];
    suspicion = level.startSuspicion;
    turnsSurvived = 0;
    excuses = [];
    spent.clear();
    askedFor = null;
    visitorSaid = "";
    history = [];
    carried.text = "";
    carried.words.length = 0;
    over = false;

    emit({
      type: "prep_start",
      level: level.id,
      slots: EXCUSE_SLOTS,
      secondsAllowed: PREP_SECONDS,
      at: at(),
    });
  }

  /**
   * The door closes, and either the next one is ahead or the night is over.
   *
   * Being caught ends the night wherever it happens: there is no carrying on
   * once somebody has stopped believing you.
   */
  async function endLevel(result: "won" | "caught") {
    over = true;
    canSpeak = false;
    clearDeadAir();
    // The door is shut, so stop listening at it. Nothing should be billing
    // while the player reads the result or writes the next set of excuses.
    closeEars();

    emit({
      type: "level_end",
      level: level.id,
      result,
      suspicion,
      elapsedMs: at(),
      at: at(),
    });

    const lastDoor = levelIndex >= opts.levels.length - 1;
    if (result === "caught" || lastDoor) {
      runOver = true;
      emit({
        type: "run_end",
        result,
        levelsCleared: result === "won" ? opts.levels.length : levelIndex,
        at: at(),
      });
      return;
    }

    // A beat to read what happened before the next one knocks.
    await sleep(2200);
    if (stopped || runOver) return;
    levelIndex += 1;
    beginLevel();
  }

  /**
   * Shut the transcript down the moment the night is over.
   *
   * A streaming session bills for as long as its socket is open, and the end
   * screen can sit there for minutes while someone listens back to the tape.
   * It stays open between doors, though: one socket for the night costs a
   * little idle time during prep and saves minting a token at every door,
   * which is what the run budget actually counts.
   */
  function closeEars() {
    stt?.terminate();
    stt = null;
  }

  function clearDeadAir() {
    if (deadAirTimer) clearTimeout(deadAirTimer);
    deadAirTimer = null;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = null;
  }

  /**
   * Saying nothing is an answer, and a bad one. The grace window is generous
   * on purpose — the player has to read the question, pick a grown-up and find
   * the key, and punishing that would punish learning the game rather than
   * playing it badly.
   */
  async function onDeadAir() {
    if (stopped || over || holding || awaiting || !canSpeak) return;
    canSpeak = false;
    if (applyScore(deadAir())) return;

    const line = await writeNextLine();
    if (stopped || over) return;
    await visitorSays(line);
    if (!stopped) ready();
  }

  /** The visitor's next line, written while the grown-up is still talking. */
  async function writeNextLine(): Promise<Line> {
    try {
      const res = await fetch("/api/visitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: level.id, history, claims }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Line;
      return {
        text: data.text,
        addressedTo: data.addressedTo,
        contradiction: data.contradiction ?? null,
      };
    } catch {
      // The visitor still has to say something, or the encounter just stops.
      // A failed judgement is not a contradiction — never score on a guess.
      fail("brain_failed", "the visitor lost their thread for a moment");
      return { text: "Sorry — say that again?", addressedTo: null, contradiction: null };
    }
  }

  function ready() {
    if (over) return;
    canSpeak = true;
    // graceMs is what lets the screen show the silence running out. The engine
    // stays the authority on when it actually runs out; the bar is a report.
    emit({ type: "mic_state", state: "idle", graceMs: DEAD_AIR_GRACE_MS, at: at() });
    clearDeadAir();

    // Two thirds of the way through the quiet, one rap. It says the same thing
    // the draining bar says, for anyone listening rather than looking.
    nudgeTimer = setTimeout(
      () => {
        if (ctx && canSpeak && !holding && !awaiting && !over) nudge(ctx);
      },
      Math.round(DEAD_AIR_GRACE_MS * 0.64),
    );

    deadAirTimer = setTimeout(() => void onDeadAir(), DEAD_AIR_GRACE_MS);
  }

  async function onTurn(turn: SttTurn) {
    if (!awaiting) {
      // The model ended a turn by itself, at a pause, while the key was still
      // down. Carry the words and glue them onto the turn the release makes.
      carried.text = `${carried.text} ${turn.transcript}`.trim();
      carried.words.push(...turn.words);
      return;
    }

    const transcript = `${carried.text} ${turn.transcript}`.trim();
    const words = [...carried.words, ...turn.words];
    carried.text = "";
    carried.words.length = 0;
    awaiting = false;

    if (!transcript) {
      ready();
      return;
    }

    const voice = heldVoice;
    const shaped = shapeForSpeech(
      transcript,
      words,
      (s, e) => mic?.loudnessBetween(s, e) ?? 0,
      mic?.baseline() ?? 0.05,
    );

    let playerAudio: SpokenLine;
    try {
      const played = await play(shaped.text, GROWNUP_BY_ID[voice].voiceId);
      playerAudio = played.spoken;
      emit({
        type: "player_line",
        id: played.id,
        text: transcript,
        spokenText: shaped.text,
        voice,
        timings: played.spoken.timings,
        durationMs: played.spoken.durationMs,
        shouted: shaped.shouted,
        playbackOffsetMs: Math.max(0, (ctx!.currentTime - played.spoken.startedAt) * 1000),
        fromExcuseSlot: null,
        at: at(),
      });
    } catch {
      fail("tts_failed", "the house went quiet — that line never made it out");
      ready();
      return;
    }

    history.push({ speaker: voice, text: shaped.text });
    claims.push({ voice, text: shaped.text, level: level.id, at: at() });
    turnsSurvived += 1;

    // Everything the code can judge is known the moment the words land. The one
    // thing it cannot judge arrives with the visitor's next line, so the model
    // is asked even on the turn that would win the level — being caught on the
    // last word is a better ending than a free pass.
    const facts: Omit<TurnFacts, "contradiction"> = {
      transcript,
      words,
      voice,
      askedFor,
      visitorSaid,
      baseline: mic?.baseline() ?? 0.05,
      loudnessBetween: (s, e) => mic?.loudnessBetween(s, e) ?? 0,
      priorClaims: claims.length - 1,
    };

    // The model writes while the grown-up talks, so by the time the house is
    // quiet the visitor already knows their line and the meter can move.
    await afterPlayerLine(playerAudio, (contradiction) =>
      scoreTurn({ ...facts, contradiction }),
    );
  }

  /**
   * What happens after the house has spoken, however it spoke.
   *
   * Live answer or prepared line, the shape is the same: ask the model while
   * the grown-up is still talking, move the meter once the judgement is back,
   * and only then let the visitor reply. The score function is passed in
   * because that is the only part the two paths disagree about.
   */
  async function afterPlayerLine(
    audio: SpokenLine,
    score: (contradiction: Line["contradiction"]) => Scored,
  ) {
    const next = writeNextLine();
    await waitOutAudio(audio);
    if (stopped) return;

    const line = await next;
    if (stopped) return;

    if (applyScore(score(line.contradiction))) return;

    if (turnsSurvived >= level.turnsToWin) {
      void endLevel("won");
      return;
    }

    await visitorSays(line);
    if (!stopped) ready();
  }

  /** A prepared line, fired from a hotkey. No mic, no hesitation, no waiting. */
  async function speakExcuse(slot: number, excuse: Excuse) {
    const reused = spent.has(slot);
    spent.add(slot);

    let audio: SpokenLine;
    try {
      const played = await play(excuse.text, GROWNUP_BY_ID[excuse.voice].voiceId);
      audio = played.spoken;
      emit({
        type: "player_line",
        id: played.id,
        text: excuse.text,
        spokenText: excuse.text,
        voice: excuse.voice,
        timings: played.spoken.timings,
        durationMs: played.spoken.durationMs,
        shouted: [],
        playbackOffsetMs: Math.max(0, (ctx!.currentTime - played.spoken.startedAt) * 1000),
        fromExcuseSlot: slot,
        at: at(),
      });
    } catch {
      fail("tts_failed", "the house went quiet — that line never made it out");
      ready();
      return;
    }

    history.push({ speaker: excuse.voice, text: excuse.text });
    claims.push({ voice: excuse.voice, text: excuse.text, level: level.id, at: at() });

    // Deliberately does NOT advance turnsSurvived. A door needs as many answers
    // as it needs, and the first one needed exactly as many as there are excuse
    // slots — so three taps cleared the pizza driver without the player ever
    // opening their mouth, in a game whose entire subject is the voice.
    //
    // A prepared line still does everything else: it keeps the silence off the
    // meter, it scores, and it buys a moment to think. It just does not satisfy
    // the person at the door, which is the honest reading of a line written
    // before you knew the question.

    const priorClaims = claims.length - 1;
    await afterPlayerLine(audio, (contradiction) =>
      scoreExcuse({ voice: excuse.voice, askedFor, contradiction, priorClaims, reused }),
    );
  }

  return {
    async start() {
      // The AudioContext has to be made inside the player's own click, before
      // anything is awaited, or the browser will not let it make sound.
      try {
        ctx = new AudioContext({ sampleRate: 24000 });
        void ctx.resume();
      } catch (err) {
        fail("unknown", err instanceof Error ? err.message : "no audio", false);
        return;
      }

      beginLevel();

      // Everything else opens behind the prep screen. The microphone prompt,
      // a token, the transcript socket and waking the model together cost
      // several seconds that the player now spends writing rather than
      // watching a spinner — and the permission prompt lands over a page that
      // explains itself rather than over a blank one. The click's activation
      // still covers the microphone request, because it is made immediately.
      setup = (async () => {
        try {
          mic = await startMic((frame) => {
            stt?.send(frame.pcm);
            // Only while the key is down: this is the player watching their
            // own voice, and there is nothing to watch when nobody is talking.
            if (!holding) return;
            emit({
              type: "mic_state",
              state: "listening",
              level: frame.rms,
              baseline: holdBaseline,
              at: at(),
            });
          });
        } catch {
          fail("mic_denied", "Cover Story needs the microphone — it is the whole game.", false);
          throw new Error("no mic");
        }

        await freshTokens();

        void fetch("/api/visitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: level.id, history: [], warm: true }),
        }).catch(() => {});
      })();

      setup.catch(() => {});
    },

    async submitPrep(written) {
      excuses = written;
      emit({ type: "prep_end", level: level.id, excuses, at: at() });

      try {
        await setup;
      } catch {
        return; // the failure already went out as an error event
      }
      if (stopped) return;

      // A fresh session for this door, opened now rather than behind the prep
      // screen: a streaming session bills from the moment its socket opens,
      // and prep would spend that on watching somebody type. The first door
      // already has its tokens from setup; every door after it needs its own,
      // because the last one's expired with its session.
      if (!stt && levelIndex > 0) {
        try {
          await freshTokens();
        } catch {
          return; // already reported
        }
      }

      try {
        if (!stt) stt = await openStt({
          token: sttToken,
          onPartial: (partial) =>
            emit({ type: "mic_state", state: "listening", partial, at: at() }),
          onTurn: (turn) => void onTurn(turn),
          onError: (message) => fail("stt_lost", message),
          onClose: () => {
            // Without this the game hangs in total silence: sends and
            // ForceEndpoint both no-op on a closed socket, so the player holds
            // a key, talks, lets go, and nothing ever answers. Saying so is
            // worse than it working and far better than pretending.
            if (runOver || stopped) return;
            fail("stt_lost", "The line went dead. The house cannot hear you any more.", false);
          },
        });
      } catch (err) {
        fail("stt_lost", err instanceof Error ? err.message : "could not listen", false);
        return;
      }

      // Before anything else: the thing the whole game is named after.
      if (ctx) knock(ctx);

      emit({
        type: "level_start",
        level: level.id,
        brief: level.brief,
        visitorName: level.visitorName,
        want: level.want,
        at: at(),
      });

      try {
        await visitorSays({
          text: level.opener,
          addressedTo: level.expects,
          contradiction: null,
        });
        if (!stopped) ready();
      } catch (err) {
        fail("unknown", err instanceof Error ? err.message : "the door would not open", false);
      }
    },

    hold(voice) {
      if (stopped || over || holding || awaiting || !canSpeak || !mic) return;
      clearDeadAir();
      // Once per turn rather than per frame: a median over the whole track is
      // cheap occasionally and wasteful fifteen times a second.
      holdBaseline = mic.baseline();
      holding = true;
      canSpeak = false;
      heldVoice = voice;
      mic.open();
      emit({ type: "mic_state", state: "listening", partial: "", at: at() });
    },

    release() {
      if (!holding) return;
      holding = false;
      awaiting = true;
      // Shutting the gate pushes the part-filled chunk, so the tail of the last
      // word is already on the wire when the turn is asked to end.
      mic?.close();
      stt?.forceEndpoint();
      emit({ type: "mic_state", state: "finalising", at: at() });
    },

    fire(slot) {
      if (stopped || over || holding || awaiting || !canSpeak) return;
      const excuse = excuses[slot];
      if (!excuse || !excuse.text.trim()) return;
      canSpeak = false;
      clearDeadAir();
      void speakExcuse(slot, excuse);
    },

    recording: () => ({ startedAt: runStart, events: [...journal], clips }),

    stop() {
      stopped = true;
      clearDeadAir();
      stt?.terminate();
      stt = null;
      mic?.stop();
      mic = null;
      void ctx?.close();
      ctx = null;
    },
  };
}
