/**
 * The core loop.
 *
 * One encounter, start to finish: the visitor speaks, the player holds a key
 * and answers, the answer comes back out of the house in a grown-up's voice,
 * and the visitor responds to what was actually said.
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
import type { GameEvent, LevelId, Speaker, VoiceId } from "@/lib/events";

export type Engine = {
  start: () => Promise<void>;
  /** a voice key went down */
  hold: (voice: VoiceId) => void;
  /** the voice key came up */
  release: () => void;
  stop: () => void;
};

type ErrorCode = Extract<GameEvent, { type: "error" }>["code"];

type Line = { text: string; addressedTo: VoiceId | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function createEngine(opts: {
  level: LevelId;
  onEvent: (event: GameEvent) => void;
}): Engine {
  const level = LEVEL_BY_ID[opts.level];
  const runStart = performance.now();
  /** ms since the run began — every event is stamped on this one clock */
  const at = () => Math.round(performance.now() - runStart);

  let ctx: AudioContext | null = null;
  let mic: Mic | null = null;
  let stt: SttSession | null = null;
  let ttsToken = "";

  let stopped = false;
  /** the house is quiet and the player may answer */
  let canSpeak = false;
  let holding = false;
  /** a release is out and we are waiting for its final turn */
  let awaiting = false;
  let heldVoice: VoiceId = "dad";
  let turnsSurvived = 0;
  let lines = 0;

  /** words from turns the model closed by itself, mid-hold */
  const carried = { text: "", words: [] as SttWord[] };
  const history: { speaker: Speaker; text: string }[] = [];

  const emit = (event: GameEvent) => {
    if (!stopped) opts.onEvent(event);
  };

  const fail = (code: ErrorCode, message: string) =>
    emit({ type: "error", code, message, recoverable: code !== "mic_denied", at: at() });

  async function play(text: string, voiceId: string) {
    const id = `l${lines++}`;
    const spoken = await speakLine({ ctx: ctx!, token: ttsToken, text, voiceId });
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
      at: at(),
    });
    history.push({ speaker: "visitor", text: line.text });
    await waitOutAudio(spoken);
  }

  /** The visitor's next line, written while the grown-up is still talking. */
  async function writeNextLine(): Promise<Line> {
    try {
      const res = await fetch("/api/visitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: level.id, history }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Line;
      return { text: data.text, addressedTo: data.addressedTo };
    } catch {
      // The visitor still has to say something, or the encounter just stops.
      fail("brain_failed", "the visitor lost their thread for a moment");
      return { text: "Sorry — say that again?", addressedTo: null };
    }
  }

  function ready() {
    canSpeak = true;
    emit({ type: "mic_state", state: "idle", at: at() });
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
        fromExcuseSlot: null,
        at: at(),
      });
    } catch {
      fail("tts_failed", "the house went quiet — that line never made it out");
      ready();
      return;
    }

    history.push({ speaker: voice, text: shaped.text });
    turnsSurvived += 1;

    // Both of these start now. The model writes while the grown-up talks, so by
    // the time the house is quiet the visitor already knows their line.
    const won = turnsSurvived >= level.turnsToWin;
    const next = won ? null : writeNextLine();

    await waitOutAudio(playerAudio);
    if (stopped) return;

    if (!next) {
      emit({
        type: "level_end",
        level: level.id,
        result: "won",
        suspicion: 0,
        elapsedMs: at(),
        at: at(),
      });
      return;
    }

    await visitorSays(await next);
    if (!stopped) ready();
  }

  return {
    async start() {
      try {
        const res = await fetch("/api/token", { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          fail(body.error === "budget" ? "budget" : "unknown", body.message ?? "could not start");
          return;
        }
        const tokens = (await res.json()) as { stt: string; tts: string };
        ttsToken = tokens.tts;

        // Made inside the player's click, or the browser won't let it sound.
        ctx = new AudioContext({ sampleRate: 24000 });
        await ctx.resume();

        stt = await openStt({
          token: tokens.stt,
          onPartial: (partial) =>
            emit({ type: "mic_state", state: "listening", partial, at: at() }),
          onTurn: (turn) => void onTurn(turn),
          onError: (message) => fail("stt_lost", message),
        });

        try {
          mic = await startMic((frame) => stt?.send(frame.pcm));
        } catch {
          fail("mic_denied", "Cover Story needs the microphone — it is the whole game.");
          return;
        }

        // Wakes the model while the opener plays, so the player's first answer
        // is not the one that pays for the cold start.
        void fetch("/api/visitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: level.id, history: [], warm: true }),
        }).catch(() => {});

        emit({
          type: "level_start",
          level: level.id,
          brief: level.brief,
          visitorName: level.visitorName,
          want: level.want,
          at: at(),
        });

        await visitorSays({ text: level.opener, addressedTo: level.expects });
        if (!stopped) ready();
      } catch (err) {
        fail("unknown", err instanceof Error ? err.message : "could not start");
      }
    },

    hold(voice) {
      if (stopped || holding || awaiting || !canSpeak || !mic) return;
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

    stop() {
      stopped = true;
      stt?.terminate();
      stt = null;
      mic?.stop();
      mic = null;
      void ctx?.close();
      ctx = null;
    },
  };
}
