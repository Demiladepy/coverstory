"use client";

/**
 * The encounter, on screen.
 *
 * Everything here is a reduction over the engine's event stream — no
 * component reaches into the engine to ask it anything. That is what
 * freezing the contract bought: this screen could be thrown away and
 * rebuilt, which is exactly what happened.
 *
 * The layout owes its shape to Papers, Please. Not the pixels — the
 * structure. That game puts the whole job on one cramped screen with
 * nowhere to look away to, and the interface is the booth rather than a
 * readout about the booth. So this is three zones, one viewport, never
 * scrolling: what is beyond the door, the door, and your side of it.
 *
 * The control is one gesture rather than two. Holding 1, 2 or 3 both picks
 * the grown-up and opens the mic, because at a door those are the same
 * decision. It also means "which voice answered" is simply which key was
 * down, which is the signal the wrong-voice penalty reads.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "@/game/engine";
import { LEVELS, LEVEL_BY_ID } from "@/game/levels";
import { GROWNUPS } from "@/game/voices";
import { REASON_LABEL, type ScoredReason } from "@/game/score";
import { SHOUT_RATIO } from "@/game/shout";
import {
  EXCUSE_KEYS,
  PREP_SECONDS,
  VOICE_KEYS,
  VOICE_LABEL,
  type Excuse,
  type GameEvent,
  type LevelId,
  type RunLog,
  type VoiceId,
  type WordTiming,
} from "@/lib/events";
import { setMuted } from "@/lib/sfx";
import Replay from "./Replay";

type Speech = { timings: WordTiming[]; durationMs: number; anchor: number };

type Phase = "ready" | "prep" | "opening" | "playing" | "over" | "failed";

const BLANK: Excuse[] = [
  { text: "", voice: "dad" },
  { text: "", voice: "mom" },
  { text: "", voice: "uncle" },
];

/** Not instructions — the shape of a line that works, so the blank page isn't one. */
const HINTS = [
  "He's in the shower, can you come back?",
  "I'm on a call, just leave it by the step.",
  "They're not here, I'm watching the place.",
];

/** Above this, the light under the door stops being your hallway lamp. */
const HOT = 65;

export default function Play() {
  const [levelId, setLevelId] = useState<LevelId>("pizza");
  const [phase, setPhase] = useState<Phase>("ready");
  const [visitorLine, setVisitorLine] = useState("");
  const [addressedTo, setAddressedTo] = useState<VoiceId | null>(null);
  const [speech, setSpeech] = useState<Speech | null>(null);
  const [intoClip, setIntoClip] = useState(-1);
  const [hushed, setHushed] = useState(false);
  const [loudness, setLoudness] = useState({ level: 0, baseline: 0.05 });
  const [turnsDone, setTurnsDone] = useState(0);
  const [spokenText, setSpokenText] = useState("");
  const [micState, setMicState] = useState<"idle" | "listening" | "finalising">("idle");
  const [partial, setPartial] = useState("");
  const [suspicion, setSuspicion] = useState(LEVELS[0].startSuspicion);
  const [reasons, setReasons] = useState<ScoredReason[]>([]);
  const [result, setResult] = useState<"won" | "caught" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [held, setHeld] = useState<VoiceId | null>(null);
  const [drafts, setDrafts] = useState<Excuse[]>(BLANK);
  const [prepLeft, setPrepLeft] = useState(PREP_SECONDS);
  const [spent, setSpent] = useState<number[]>([]);
  const [recording, setRecording] = useState<RunLog | null>(null);

  const engine = useRef<Engine | null>(null);
  // The countdown submits on a timer, so it needs the latest drafts without
  // re-arming that timer on every keystroke.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const onEvent = useCallback((event: GameEvent) => {
    switch (event.type) {
      case "prep_start":
        setPhase("prep");
        setPrepLeft(event.secondsAllowed);
        break;
      case "level_start":
        setPhase("playing");
        break;
      case "visitor_line":
        setVisitorLine(event.text);
        setAddressedTo(event.addressedTo);
        // Anchored to when the clip actually started, not to now: the timings
        // arrive once the response has been read, by which point the voice is
        // already a word or two in.
        setSpeech({
          timings: event.timings,
          durationMs: event.durationMs,
          anchor: performance.now() - event.playbackOffsetMs,
        });
        break;
      case "player_line": {
        setSpokenText(event.spokenText);
        setPartial("");
        setTurnsDone((n) => n + 1);
        const slot = event.fromExcuseSlot;
        if (slot !== null) setSpent((s) => (s.includes(slot) ? s : [...s, slot]));
        break;
      }
      case "suspicion":
        setSuspicion(event.value);
        setReasons(event.reasons);
        break;
      case "mic_state":
        setMicState(event.state);
        if (event.partial !== undefined) setPartial(event.partial);
        if (event.level !== undefined) {
          setLoudness({ level: event.level, baseline: event.baseline ?? 0.05 });
        }
        if (event.state !== "listening") setLoudness((l) => ({ ...l, level: 0 }));
        break;
      case "level_end":
        setResult(event.result);
        setPhase("over");
        // Grabbed here rather than on teardown: the engine still holds every
        // clip it played, and stopping it is what throws them away.
        setRecording(engine.current?.recording() ?? null);
        break;
      case "error":
        setError(event.message);
        setErrorCode(event.code);
        // A run that cannot continue is not a loss. Showing "they stopped
        // believing you" because the microphone was refused blames the player
        // for something the browser did.
        if (!event.recoverable) setPhase("failed");
        break;
    }
  }, []);

  const begin = useCallback(async () => {
    setError(null);
    setErrorCode(null);
    setSuspicion(LEVEL_BY_ID[levelId].startSuspicion);
    setPhase("opening");
    const made = createEngine({ level: levelId, onEvent });
    engine.current = made;
    await made.start();
  }, [levelId, onEvent]);

  const stop = useCallback(() => {
    engine.current?.stop();
    engine.current = null;
    setPhase("ready");
    setVisitorLine("");
    setSpokenText("");
    setPartial("");
    setResult(null);
    setHeld(null);
    setSuspicion(LEVEL_BY_ID[levelId].startSuspicion);
    setReasons([]);
    setDrafts(BLANK);
    setPrepLeft(PREP_SECONDS);
    setSpent([]);
    setRecording(null);
    setTurnsDone(0);
    setLoudness({ level: 0, baseline: 0.05 });
  }, [levelId]);

  // Remembered per browser, and harmless if storage is unavailable.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cs_hush") === "1";
      setHushed(saved);
      setMuted(saved);
    } catch {
      // private window, blocked storage: sound simply stays on
    }
  }, []);

  const toggleHush = useCallback(() => {
    setHushed((was) => {
      const now = !was;
      setMuted(now);
      try {
        localStorage.setItem("cs_hush", now ? "1" : "0");
      } catch {
        // nothing to do; the setting just will not survive a reload
      }
      return now;
    });
  }, []);

  useEffect(() => () => engine.current?.stop(), []);

  // Follow the voice through the line, so the words arrive as they are said
  // rather than all at once. The timings came back with the audio; this is the
  // only place they are used live rather than in the replay.
  useEffect(() => {
    if (!speech || speech.timings.length === 0) return;
    let frame = 0;
    const follow = () => {
      const into = performance.now() - speech.anchor;
      if (into > speech.durationMs + 150) {
        setIntoClip(-1);
        return;
      }
      setIntoClip(into);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [speech]);

  // The reasons are a reaction, not a readout. They say why the meter moved
  // and then get out of the way, so the door is not permanently annotated.
  useEffect(() => {
    if (reasons.length === 0) return;
    const clear = setTimeout(() => setReasons([]), 6000);
    return () => clearTimeout(clear);
  }, [reasons]);

  const submitPrep = useCallback(async () => {
    setPhase("opening");
    await engine.current?.submitPrep(draftsRef.current);
  }, []);

  // Prep runs on a clock. Running out is not a punishment — whatever is
  // written is kept — it is there so the player writes what comes to mind
  // rather than drafting, which is the difference between an excuse and an
  // essay.
  useEffect(() => {
    if (phase !== "prep") return;
    if (prepLeft <= 0) {
      void submitPrep();
      return;
    }
    const tick = setTimeout(() => setPrepLeft((n) => n - 1), 1000);
    return () => clearTimeout(tick);
  }, [phase, prepLeft, submitPrep]);

  useEffect(() => {
    if (phase !== "playing") return;

    const down = (e: KeyboardEvent) => {
      const slot = EXCUSE_KEYS.indexOf(e.key as (typeof EXCUSE_KEYS)[number]);
      if (slot >= 0 && !e.repeat && !held) {
        e.preventDefault();
        engine.current?.fire(slot);
        return;
      }

      const voice = VOICE_KEYS[e.key];
      if (!voice || e.repeat || held) return;
      e.preventDefault();
      setHeld(voice);
      engine.current?.hold(voice);
    };

    const up = (e: KeyboardEvent) => {
      const voice = VOICE_KEYS[e.key];
      if (!voice || voice !== held) return;
      e.preventDefault();
      setHeld(null);
      engine.current?.release();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, held]);

  const pressVoice = (voice: VoiceId) => {
    if (phase !== "playing" || held) return;
    setHeld(voice);
    engine.current?.hold(voice);
  };

  const releaseVoice = () => {
    if (!held) return;
    setHeld(null);
    engine.current?.release();
  };

  const level = LEVEL_BY_ID[levelId];
  const hot = suspicion >= HOT;

  // The bar is scaled so the shout line always sits at the same place on it,
  // whoever is talking. Where your normal voice lands is not the point; how
  // far past it you are is.
  const shoutAt = Math.max(0.02, loudness.baseline) * SHOUT_RATIO;
  const fullScale = shoutAt / 0.62;
  const filled = Math.min(100, (loudness.level / fullScale) * 100);
  const shouting = loudness.level > shoutAt;

  const trouble = error && phase !== "failed" ? <p className="trouble">{error}</p> : null;

  if (phase === "ready") {
    return (
      <main className="night">
        <div className="card scroller">
          {trouble}
          <p className="title">Cover Story</p>
          <h1 className="big-line">Someone is at the door.</h1>
          <p className="lede">
            You are twelve and the house is empty. Hold <b>1</b>, <b>2</b> or <b>3</b> and talk
            — whatever you say comes back out of the house in Dad&rsquo;s, Mom&rsquo;s or
            Uncle&rsquo;s voice, stammers and all. Let go when you&rsquo;re done.
          </p>

          <p className="title" style={{ marginTop: 26 }}>Who it is tonight</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
            {LEVELS.map((l) => (
              <button
                key={l.id}
                className="note"
                style={{
                  borderStyle: "solid",
                  borderColor: l.id === levelId ? "var(--lamp-deep)" : "#272c38",
                  color: l.id === levelId ? "var(--lamp)" : "var(--cold-dim)",
                  padding: "10px 12px",
                }}
                onClick={() => setLevelId(l.id)}
              >
                <span className="txt" style={{ fontSize: 13 }}>{l.brief}</span>
                <span className="num">{l.turnsToWin} turns</span>
              </button>
            ))}
          </div>

          <p className="lede" style={{ marginBottom: 18 }}>
            They want {level.want}.
          </p>
          <button className="go" onClick={() => void begin()}>
            Get your story straight
          </button>
        </div>
      </main>
    );
  }

  if (phase === "prep") {
    return (
      <main className="night">
        <div className="card scroller">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p className="title">Before they knock</p>
            <span className={`clock ${prepLeft <= 10 ? "soon" : ""}`}>{prepLeft}s</span>
          </div>
          <p className="lede">
            Write three lines you can fire without thinking, and pick who says each. They come
            out instantly and perfectly — no stammer, no pause. But they were written before you
            knew the question, so a line that doesn&rsquo;t fit will cost you, and saying the
            same one twice costs more.
          </p>

          {drafts.map((draft, i) => (
            <div key={EXCUSE_KEYS[i]} className="noteline">
              <span className="num">{EXCUSE_KEYS[i]}</span>
              <input
                value={draft.text}
                placeholder={HINTS[i]}
                maxLength={120}
                autoFocus={i === 0}
                onChange={(e) =>
                  setDrafts((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
              />
              <span className="pick">
                {GROWNUPS.map((g) => (
                  <button
                    key={g.id}
                    className={draft.voice === g.id ? "on" : ""}
                    onClick={() =>
                      setDrafts((d) => d.map((x, j) => (j === i ? { ...x, voice: g.id } : x)))
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </span>
            </div>
          ))}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18 }}>
            <button className="go" onClick={() => void submitPrep()}>
              Let them knock
            </button>
            <span className="clock" style={{ letterSpacing: 0 }}>
              Blank slots are fine. You can always just talk.
            </span>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "opening") {
    return (
      <main className="night">
        <div className="card">
          <p className="title">Listening</p>
          <h1 className="big-line">Someone is coming up the path.</h1>
        </div>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main className="night">
        <div className="card scroller">
          <p className="title">{errorCode === "budget" ? "Come back later" : "Not your fault"}</p>
          <h1 className="big-line">
            {errorCode === "budget" ? "This link is out of runs." : "The run stopped before it started."}
          </h1>
          <p className="lede">
            {errorCode === "mic_denied"
              ? "Allow the microphone for this page and go again — the whole game is your voice, so there is no playing around it."
              : errorCode === "budget"
                ? "It is a demo on someone's own key, so there is an hourly limit on it. Try again later."
                : error}
          </p>
          <button className="go" onClick={stop}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (phase === "over") {
    return (
      <main className="night">
        <div className="card scroller">
          <p className="title">{result === "won" ? "They left" : "Caught"}</p>
          <h1 className="big-line">
            {result === "won"
              ? "You talked them off the step."
              : "They stopped believing you."}
          </h1>
          <p className="lede">
            {result === "won"
              ? `The meter finished at ${suspicion}. The story held — this time.`
              : "Something in it stopped adding up, and they heard it."}
          </p>

          {recording && result && (
            <Replay log={recording} level={level} result={result} suspicion={suspicion} />
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="go" onClick={stop}>
              Another door
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Playing. Three zones, one screen, no scrolling.
  return (
    <main className="night">
      <section className="outside">
        <button className="hush" onClick={toggleHush}>
          {hushed ? "sound off" : "sound on"}
        </button>

        <div className="whoisit">
          {level.brief} &nbsp;·&nbsp; <b>{level.visitorName}</b>
          <span className="pips" title={`${turnsDone} of ${level.turnsToWin} answered`}>
            {Array.from({ length: level.turnsToWin }, (_, i) => (
              <i key={i} className={i < turnsDone ? "on" : ""} />
            ))}
          </span>
        </div>
        <p className="saidoutside">
          {speech && speech.timings.length > 0 ? (
            speech.timings.map((word, i) => {
              const state =
                intoClip < 0 || intoClip > word.end
                  ? "said"
                  : intoClip >= word.start
                    ? "lit"
                    : "coming";
              return (
                <span key={`${i}-${word.text}`} className={`w ${state}`}>
                  {word.text}{" "}
                </span>
              );
            })
          ) : (
            visitorLine || " "
          )}
        </p>
        {addressedTo && <div className="asking">asking for {VOICE_LABEL[addressedTo]}</div>}
      </section>

      <section className={`door ${micState === "listening" ? "live" : ""}`}>
        <div className="doorstate">
          <span className="dot" />
          {micState === "listening"
            ? `${held ? VOICE_LABEL[held] : "Someone"} is answering`
            : micState === "finalising"
              ? "…"
              : "Hold 1, 2 or 3 to answer"}
          {micState === "listening" && (
            <span className={`vu ${shouting ? "loud" : ""}`} aria-hidden="true">
              <span className="vu-fill" style={{ width: `${filled}%` }} />
              <span className="vu-mark" />
            </span>
          )}
        </div>

        <p className="heard">{partial || spokenText || " "}</p>

        <div className="ticks">
          {reasons.map((r, i) => (
            <span key={`${r.reason}-${i}`} className={r.points > 0 ? "up" : "down"}>
              {REASON_LABEL[r.reason]} {r.points > 0 ? "+" : ""}
              {r.points}
            </span>
          ))}
        </div>

        <div className={`pressure ${hot ? "hot" : ""}`}>
          <span className="word">suspicion</span>
          <b>{suspicion}</b>
        </div>

        <div
          className={`underlight ${hot ? "hot" : ""}`}
          style={{ height: `${2 + (Math.min(100, suspicion) / 100) * 18}px` }}
        />
      </section>

      <section className="inside">
        <div className="keys">
          {GROWNUPS.map((g) => (
            <button
              key={g.id}
              className={`vkey ${held === g.id ? "down" : ""}`}
              disabled={micState === "finalising"}
              onPointerDown={() => pressVoice(g.id)}
              onPointerUp={releaseVoice}
              onPointerLeave={releaseVoice}
            >
              <span className="num">{g.key}</span>
              <span className="name">{g.label}</span>
              <span className="note">{g.note}</span>
            </button>
          ))}
        </div>

        {drafts.some((d) => d.text.trim()) && (
          <div className="notes">
            {drafts.map((draft, i) =>
              draft.text.trim() ? (
                <button
                  key={EXCUSE_KEYS[i]}
                  className={`note ${spent.includes(i) ? "used" : ""}`}
                  onClick={() => engine.current?.fire(i)}
                  title={spent.includes(i) ? "They have heard this one" : undefined}
                >
                  <span className="num">{EXCUSE_KEYS[i]}</span>
                  <span className="txt">{draft.text}</span>
                  <span className="num">{VOICE_LABEL[draft.voice]}</span>
                </button>
              ) : null,
            )}
          </div>
        )}
      </section>
    </main>
  );
}
