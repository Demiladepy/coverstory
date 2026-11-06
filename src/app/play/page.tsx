"use client";

/**
 * The encounter, on screen.
 *
 * Everything here is a reduction over the engine's event stream, no
 * component reaches into the engine to ask it anything. That is what
 * freezing the contract bought: this screen could be thrown away and
 * rebuilt, which is exactly what happened.
 *
 * The layout owes its shape to Papers, Please. Not the pixels, the
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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
import Hallway from "./Hallway";

type Speech = { timings: WordTiming[]; durationMs: number; anchor: number };

/** The house's own line, plus which of its words the player shouted. */
type HouseSpeech = Speech & { shouted: Set<string> };

/** Words come back from the voice with punctuation attached; this is for comparing them. */
function bare(word: string): string {
  return word.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();
}

type Phase = "ready" | "prep" | "opening" | "playing" | "between" | "over" | "failed";

const BLANK: Excuse[] = [
  { text: "", voice: "dad" },
  { text: "", voice: "mom" },
  { text: "", voice: "uncle" },
];

/** Not instructions, the shape of a line that works, so the blank page isn't one. */
const HINTS = [
  "He's in the shower, can you come back?",
  "I'm on a call, just leave it by the step.",
  "They're not here, I'm watching the place.",
];

/** Above this, the light under the door stops being your hallway lamp. */
const HOT = 65;

export default function Play() {
  /** the door the night starts at */
  const [levelId, setLevelId] = useState<LevelId>("pizza");
  /** the door being answered right now, which the engine decides */
  const [playing, setPlaying] = useState<LevelId>("pizza");
  const [cleared, setCleared] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [visitorLine, setVisitorLine] = useState("");
  const [addressedTo, setAddressedTo] = useState<VoiceId | null>(null);
  const [speech, setSpeech] = useState<Speech | null>(null);
  const [intoClip, setIntoClip] = useState(-1);
  const [hushed, setHushed] = useState(false);
  /** the cover image that loaded, if any was put in public/ */
  const [art, setArt] = useState<string | null>(null);
  const [loudness, setLoudness] = useState({ level: 0, baseline: 0.05 });
  const [turnsDone, setTurnsDone] = useState(0);
  const [patience, setPatience] = useState<{ ms: number; anchor: number } | null>(null);
  const [quietFor, setQuietFor] = useState(0);
  const [house, setHouse] = useState<HouseSpeech | null>(null);
  const [intoHouse, setIntoHouse] = useState(-1);
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
        // A new door. Everything about the last one goes except the tape and
        // the story, both of which the engine is keeping.
        setPlaying(event.level);
        setSuspicion(LEVEL_BY_ID[event.level].startSuspicion);
        setPhase("prep");
        setPrepLeft(event.secondsAllowed);
        setDrafts(BLANK);
        setSpent([]);
        setTurnsDone(0);
        setReasons([]);
        setVisitorLine("");
        setAddressedTo(null);
        setSpeech(null);
        setHouse(null);
        setPatience(null);
        break;
      case "level_start":
        setPlaying(event.level);
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
        setPartial("");
        setTurnsDone((n) => n + 1);
        setHouse({
          timings: event.timings,
          durationMs: event.durationMs,
          anchor: performance.now() - event.playbackOffsetMs,
          shouted: new Set(event.shouted.map(bare)),
        });
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
        // The floor is the player's, and the clock on it starts now.
        if (event.state === "idle" && event.graceMs !== undefined) {
          setPatience({ ms: event.graceMs, anchor: performance.now() });
          setQuietFor(0);
        } else if (event.state !== "idle") {
          setPatience(null);
        }
        break;
      case "level_end":
        // One door closing is not the end of the night; run_end is.
        setResult(event.result);
        setPhase("between");
        break;
      case "run_end":
        setResult(event.result);
        setCleared(event.levelsCleared);
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
    setPlaying(levelId);
    setCleared(0);
    setPhase("opening");
    // The night runs from the door you picked to the last one.
    const from = LEVELS.findIndex((l) => l.id === levelId);
    const made = createEngine({ levels: LEVELS.slice(from).map((l) => l.id), onEvent });
    engine.current = made;
    await made.start();
  }, [levelId, onEvent]);

  const stop = useCallback(() => {
    engine.current?.stop();
    engine.current = null;
    setPhase("ready");
    setVisitorLine("");
    setPartial("");
    setResult(null);
    setHeld(null);
    setSuspicion(LEVEL_BY_ID[levelId].startSuspicion);
    setReasons([]);
    setDrafts(BLANK);
    setPrepLeft(PREP_SECONDS);
    setSpent([]);
    setRecording(null);
    setPlaying(levelId);
    setCleared(0);
    setTurnsDone(0);
    setLoudness({ level: 0, baseline: 0.05 });
    setPatience(null);
    setQuietFor(0);
    setHouse(null);
    setIntoHouse(-1);
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

  // Watch the silence run out. The engine still decides when it has, this
  // only reports it, so a browser that throttles timers cannot make the game
  // disagree with itself.
  useEffect(() => {
    if (!patience) return;
    let frame = 0;
    const watch = () => {
      const gone = performance.now() - patience.anchor;
      setQuietFor(Math.min(patience.ms, gone));
      if (gone < patience.ms) frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [patience]);

  // The same trick as the visitor's line, pointed the other way: this is the
  // player watching their own words leave the house in somebody else's voice,
  // which is the whole joke and was rendered as a static paragraph.
  useEffect(() => {
    if (!house || house.timings.length === 0) return;
    let frame = 0;
    const follow = () => {
      const into = performance.now() - house.anchor;
      if (into > house.durationMs + 150) {
        setIntoHouse(-1);
        return;
      }
      setIntoHouse(into);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [house]);

  // Drop a picture in public/ named cover.<something> and the opening screen
  // becomes it. Several extensions are tried because image tools disagree
  // about what they hand you, and being told the wrong filename after a
  // deploy is a miserable way to find out. If none of them is there every
  // load fails quietly and the drawn door stays, so this cannot break the
  // page and neither can forgetting to add one.
  useEffect(() => {
    let cancelled = false;
    // Both at once rather than one after the other: tried in series, the one
    // that is not there costs a 404 before the other is attempted, and the
    // drawn door sat on screen for seconds before the picture replaced it.
    // Two candidates only, because every extra one is another 404 in the
    // console on every single load. Only one can exist, so whichever loads is
    // the cover.
    for (const candidate of ["/cover.jpg", "/cover.png"]) {
      const probe = new window.Image();
      probe.onload = () => {
        if (!cancelled) setArt(candidate);
      };
      probe.src = candidate;
    }
    return () => {
      cancelled = true;
    };
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

  // Prep runs on a clock. Running out is not a punishment, whatever is
  // written is kept, it is there so the player writes what comes to mind
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

    // A keyup goes to whichever window has focus, so alt-tabbing mid-sentence
    // means this one never hears it: the key stays down for ever, the mic keeps
    // streaming, and the game sits saying DAD IS ANSWERING until the session
    // cap kills the socket several minutes later. Switching away is the same
    // as letting go.
    const letGo = () => {
      if (!held) return;
      setHeld(null);
      engine.current?.release();
    };
    const awayOrHidden = () => {
      if (document.hidden) letGo();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", letGo);
    document.addEventListener("visibilitychange", awayOrHidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", letGo);
      document.removeEventListener("visibilitychange", awayOrHidden);
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

  const level = LEVEL_BY_ID[playing];
  const hot = suspicion >= HOT;
  const doorsTonight = LEVELS.length - LEVELS.findIndex((l) => l.id === levelId);

  // The bar is scaled so the shout line always sits at the same place on it,
  // whoever is talking. Where your normal voice lands is not the point; how
  // far past it you are is.
  const shoutAt = Math.max(0.02, loudness.baseline) * SHOUT_RATIO;
  const fullScale = shoutAt / 0.62;
  const filled = Math.min(100, (loudness.level / fullScale) * 100);
  const shouting = loudness.level > shoutAt;

  // The same slot shows the voice while you talk and the patience while you
  // do not, because they are the same thing: the state of your turn.
  const patienceLeft = patience ? 1 - quietFor / patience.ms : 1;
  const running = patience !== null && patienceLeft > 0;

  const trouble = error && phase !== "failed" ? <p className="trouble">{error}</p> : null;

  if (phase === "ready") {
    return (
      <main
        className={`night cover ${art ? "has-art" : ""}`}
        style={art ? ({ "--art": `url("${art}")` } as CSSProperties) : undefined}
      >
        <div className="cover-words">
          {trouble}
          <p className="title">Cover Story</p>
          <h1 className="big-line">Someone is at the door.</h1>
          <p className="lede" style={{ marginBottom: 22 }}>
            You are twelve and the house is empty. Hold <b>1</b>, <b>2</b> or <b>3</b> and talk;
            it comes back out of the house in Dad&rsquo;s, Mom&rsquo;s or Uncle&rsquo;s voice,
            stammers and all.
          </p>

          <p className="title">
            Tonight: {doorsTonight} {doorsTonight === 1 ? "door" : "doors"}, in order
          </p>
          <div className="doors">
            {LEVELS.map((l, i) => {
              const from = LEVELS.findIndex((x) => x.id === levelId);
              // Doors before the one you picked are not part of tonight.
              const skipped = i < from;
              return (
                <button
                  key={l.id}
                  className={`door-row ${l.id === levelId ? "now" : ""} ${skipped ? "skipped" : ""}`}
                  onClick={() => {
                    setLevelId(l.id);
                    setPlaying(l.id);
                  }}
                >
                  <span className="when">{l.brief}</span>
                  <span className="turns">{l.turnsToWin}</span>
                </button>
              );
            })}
          </div>

          <p className="lede" style={{ marginBottom: 20, fontSize: 14 }}>
            What you tell one of them is still on the record when the next one knocks.
          </p>
          <button className="go" onClick={() => void begin()}>
            Get your story straight
          </button>
        </div>

        {/* The scene, behind the words. Vector, so it is the same picture on a
            phone and on a projector, and it steps aside if a real painting
            ever lands in public/. */}
        {!art && <Hallway />}
        <div className="grain" aria-hidden="true" />
      </main>
    );
  }

  if (phase === "prep") {
    return (
      <main className="night hall">
        <div className="card scroller form">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p className="title">Before they knock</p>
            <span className={`clock ${prepLeft <= 10 ? "soon" : ""}`}>{prepLeft}s</span>
          </div>
          <p className="lede">
            Write three lines you can fire without thinking, and pick who says each. They come
            out instantly and perfectly, no stammer, no pause. They buy you a moment, not an
            answer: the visitor still wants one, and still has to hear it from you. A line that
            doesn&rsquo;t fit will cost you, and saying the same one twice costs more.
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
      <main className="night hall">
        <div className="card">
          <p className="title">Listening</p>
          <h1 className="big-line">Someone is coming up the path.</h1>
        </div>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main className="night hall">
        <div className="card scroller">
          <p className="title">{errorCode === "budget" ? "Come back later" : "Not your fault"}</p>
          <h1 className="big-line">
            {errorCode === "budget" ? "This link is out of runs." : "The run stopped before it started."}
          </h1>
          <p className="lede">
            {errorCode === "mic_denied"
              ? "Allow the microphone for this page and go again. The whole game is your voice, so there is no playing around it."
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

  if (phase === "between") {
    return (
      <main className="night hall">
        <div className="card">
          <p className="title">{result === "won" ? "They left" : "Caught"}</p>
          <h1 className="big-line">
            {result === "won"
              ? "That one is off the step."
              : "They stopped believing you."}
          </h1>
          <p className="lede">
            {result === "won"
              ? `${turnsDone} answers, and the meter finished at ${suspicion}. Someone else is coming up the path.`
              : "The night ends here."}
          </p>
        </div>
      </main>
    );
  }

  if (phase === "over") {
    return (
      <main className="night hall">
        <div className="card scroller">
          <p className="title">{result === "won" ? "You got away with it" : "Caught"}</p>
          <h1 className="big-line">
            {result === "won"
              ? "Nobody ever asked to come in."
              : "They stopped believing you."}
          </h1>
          <p className="lede">
            {result === "won"
              ? `All ${cleared} of them talked off the step, and the story held every time.`
              : cleared === 0
                ? "The first one saw through it. Something stopped adding up, and they heard it."
                : `${cleared} ${cleared === 1 ? "door" : "doors"} survived before something stopped adding up.`}
          </p>

          {recording && result && (
            <Replay log={recording} result={result} suspicion={suspicion} />
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="go" onClick={stop}>
              Another night
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
          {micState === "listening" ? (
            <span className={`vu ${shouting ? "loud" : ""}`} aria-hidden="true">
              <span className="vu-fill" style={{ width: `${filled}%` }} />
              <span className="vu-mark" />
            </span>
          ) : micState === "idle" && running ? (
            <span
              className={`vu patience ${patienceLeft < 0.34 ? "thin" : ""}`}
              aria-hidden="true"
            >
              <span className="vu-fill" style={{ width: `${patienceLeft * 100}%` }} />
            </span>
          ) : null}
        </div>

        <p className="heard">
          {partial
            ? partial
            : house && house.timings.length > 0
              ? house.timings.map((word, i) => {
                  const state =
                    intoHouse < 0 || intoHouse > word.end
                      ? "said"
                      : intoHouse >= word.start
                        ? "lit"
                        : "coming";
                  const loud = house.shouted.has(bare(word.text));
                  return (
                    <span key={`${i}-${word.text}`} className={`hw ${state} ${loud ? "shout" : ""}`}>
                      {word.text}{" "}
                    </span>
                  );
                })
              : null}
        </p>

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
