"use client";

/**
 * The encounter, on screen.
 *
 * Everything here is a reduction over the engine's event stream — no component
 * reaches into the engine to ask it anything. That is the point of freezing the
 * contract: this screen can be rebuilt or restyled without the loop noticing.
 *
 * The control is one gesture rather than two. Holding 1, 2 or 3 both picks the
 * grown-up and opens the mic, so the player's hand never has to choose a voice
 * and then find a separate talk key while someone is waiting at the door. It
 * also means "which voice answered" is simply which key was down, which is the
 * signal the wrong-voice score will read later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createEngine, type Engine } from "@/game/engine";
import { LEVELS, LEVEL_BY_ID } from "@/game/levels";
import { GROWNUPS } from "@/game/voices";
import { REASON_LABEL, type ScoredReason } from "@/game/score";
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
} from "@/lib/events";
import Replay from "./Replay";

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

export default function Play() {
  const [levelId, setLevelId] = useState<LevelId>("pizza");
  const [phase, setPhase] = useState<Phase>("ready");
  const [brief, setBrief] = useState("");
  const [want, setWant] = useState("");
  const [visitorLine, setVisitorLine] = useState("");
  const [addressedTo, setAddressedTo] = useState<VoiceId | null>(null);
  const [spokenText, setSpokenText] = useState("");
  const [heardText, setHeardText] = useState("");
  const [lastVoice, setLastVoice] = useState<VoiceId | null>(null);
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
  // The countdown fires submit on a timer, so it needs the latest drafts
  // without re-arming the timer on every keystroke.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const onEvent = useCallback((event: GameEvent) => {
    switch (event.type) {
      case "level_start":
        setBrief(event.brief);
        setWant(event.want);
        setPhase("playing");
        break;
      case "visitor_line":
        setVisitorLine(event.text);
        setAddressedTo(event.addressedTo);
        break;
      case "prep_start":
        setPhase("prep");
        setPrepLeft(event.secondsAllowed);
        break;
      case "player_line": {
        setHeardText(event.text);
        setSpokenText(event.spokenText);
        setLastVoice(event.voice);
        setPartial("");
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
    setHeardText("");
    setPartial("");
    setResult(null);
    setHeld(null);
    setSuspicion(LEVEL_BY_ID[levelId].startSuspicion);
    setReasons([]);
    setDrafts(BLANK);
    setPrepLeft(PREP_SECONDS);
    setSpent([]);
    setRecording(null);
  }, [levelId]);

  const submitPrep = useCallback(async () => {
    setPhase("opening");
    await engine.current?.submitPrep(draftsRef.current);
  }, []);

  // Prep runs on a clock. Running out is not a punishment — whatever is written
  // is kept — it is there so the player writes what comes to mind rather than
  // drafting, which is the difference between an excuse and an essay.
  useEffect(() => {
    if (phase !== "prep") return;
    if (prepLeft <= 0) {
      void submitPrep();
      return;
    }
    const tick = setTimeout(() => setPrepLeft((n) => n - 1), 1000);
    return () => clearTimeout(tick);
  }, [phase, prepLeft, submitPrep]);

  useEffect(() => () => engine.current?.stop(), []);

  // Hold a number key to answer in that voice. Picking the voice and opening
  // the mic are the same motion, because at the door they are the same choice.
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

  const level = LEVELS.find((l) => l.id === levelId)!;

  return (
    <main className="wrap">
      <h1>Cover Story</h1>

      {error && (
        <div className="panel err">
          <h2 style={{ color: "inherit" }}>Trouble</h2>
          <div>{error}</div>
        </div>
      )}

      {phase === "ready" && (
        <div className="panel">
          <h2>Who&rsquo;s at the door</h2>
          <div className="row" style={{ marginBottom: 16 }}>
            {LEVELS.map((l) => (
              <button
                key={l.id}
                className={l.id === levelId ? "on" : ""}
                onClick={() => setLevelId(l.id)}
              >
                {l.brief}
              </button>
            ))}
          </div>
          <p className="dim" style={{ margin: "0 0 16px", lineHeight: 1.6, maxWidth: "60ch" }}>
            They want {level.want}. Hold <strong>1</strong>, <strong>2</strong> or{" "}
            <strong>3</strong> to answer as Dad, Mom or Uncle — whatever you say comes back out
            of the house in their voice. Let go when you&rsquo;re done talking.
          </p>
          <button className="primary" onClick={() => void begin()}>
            Get your story straight
          </button>
        </div>
      )}

      {phase === "prep" && (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Before they knock</h2>
            <span className={`mono ${prepLeft <= 10 ? "bad" : "faint"}`}>{prepLeft}s</span>
          </div>
          <p className="dim" style={{ margin: "0 0 16px", lineHeight: 1.6, maxWidth: "58ch" }}>
            Write three lines you can fire without thinking, and pick who says each one.
            They come out instantly and perfectly — no stammering, no pause. But they were
            written before you knew the question, so a line that doesn&rsquo;t fit will cost
            you, and saying the same one twice costs more.
          </p>

          {drafts.map((draft, i) => (
            <div key={EXCUSE_KEYS[i]} className="slot">
              <span className="key">{EXCUSE_KEYS[i]}</span>
              <input
                className="line"
                value={draft.text}
                placeholder={HINTS[i]}
                maxLength={120}
                autoFocus={i === 0}
                onChange={(e) =>
                  setDrafts((d) =>
                    d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                  )
                }
              />
              <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                {GROWNUPS.map((g) => (
                  <button
                    key={g.id}
                    className={`pill ${draft.voice === g.id ? "on" : ""}`}
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

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={() => void submitPrep()}>
              Ready &mdash; let them knock
            </button>
            <span className="faint" style={{ fontSize: 12 }}>
              Blank slots are fine. You can always just talk.
            </span>
          </div>
        </div>
      )}

      {phase === "opening" && (
        <div className="panel">
          <h2>Opening</h2>
          <p className="dim" style={{ margin: 0 }}>
            Someone is coming up the path&hellip;
          </p>
        </div>
      )}

      {phase === "failed" && (
        <div className="panel">
          <h2>{errorCode === "budget" ? "Come back later" : "That one is not on you"}</h2>
          <p className="dim" style={{ margin: "0 0 14px", lineHeight: 1.6, maxWidth: "52ch" }}>
            {errorCode === "mic_denied"
              ? "Allow the microphone for this page and go again — the whole game is your voice, so there is no playing around it."
              : errorCode === "budget"
                ? "This link has had its share of runs for the hour. It is a demo running on someone's own key, so there is a limit on it."
                : "The run stopped before it started, and not because of anything you did. Going again usually works."}
          </p>
          <button className="primary" onClick={stop}>
            Try again
          </button>
        </div>
      )}

      {(phase === "playing" || phase === "over") && (
        <>
          <div className="panel">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <span className="mono faint">{brief}</span>
              <span className="mono faint">suspicion {suspicion}</span>
            </div>
            <div className="meter">
              <div
                className="meter-fill"
                style={{ width: `${Math.min(100, suspicion)}%` }}
              />
            </div>
            {reasons.length > 0 ? (
              <div className="row" style={{ gap: 6, marginTop: 12 }}>
                {reasons.map((r, i) => (
                  <span key={`${r.reason}-${i}`} className={`tick ${r.points > 0 ? "up" : "down"}`}>
                    {REASON_LABEL[r.reason]}
                    <b>
                      {r.points > 0 ? "+" : ""}
                      {r.points}
                    </b>
                    {r.detail && <em>{r.detail}</em>}
                  </span>
                ))}
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>
                They want {want}.
              </p>
            )}
          </div>

          <div className="panel scene">
            <div className="who">
              {level.visitorName}
              {addressedTo && (
                <span className="faint"> &mdash; asking {VOICE_LABEL[addressedTo]}</span>
              )}
            </div>
            <p className="said">{visitorLine || " "}</p>
          </div>

          <div className={`talk ${micState === "listening" ? "live" : ""}`}>
            {micState === "listening"
              ? `● ${held ? VOICE_LABEL[held] : "Someone"} is talking — let go when done`
              : micState === "finalising"
                ? "…"
                : phase === "over"
                  ? "The door is shut."
                  : "Hold 1, 2 or 3 to answer"}
            <div className="mono dim" style={{ marginTop: 10, fontWeight: 400, minHeight: 20 }}>
              {partial || " "}
            </div>
          </div>

          <div className="row" style={{ marginBottom: 16 }}>
            {GROWNUPS.map((g) => (
              <button
                key={g.id}
                className={`voicekey ${held === g.id ? "on" : ""}`}
                disabled={phase !== "playing"}
                onPointerDown={() => pressVoice(g.id)}
                onPointerUp={releaseVoice}
                onPointerLeave={releaseVoice}
                title={g.note}
              >
                <span className="key">{g.key}</span>
                <span>{g.label}</span>
                <span className="faint" style={{ fontSize: 11 }}>
                  {g.note}
                </span>
              </button>
            ))}
          </div>

          {drafts.some((d) => d.text.trim()) && (
            <div className="rail">
              {drafts.map((draft, i) =>
                draft.text.trim() ? (
                  <button
                    key={EXCUSE_KEYS[i]}
                    className={`excuse ${spent.includes(i) ? "spent" : ""}`}
                    disabled={phase !== "playing"}
                    onClick={() => engine.current?.fire(i)}
                    title={spent.includes(i) ? "They have heard this one" : undefined}
                  >
                    <span className="key">{EXCUSE_KEYS[i]}</span>
                    <span className="line">{draft.text}</span>
                    <span className="faint">{VOICE_LABEL[draft.voice]}</span>
                  </button>
                ) : null,
              )}
            </div>
          )}

          {spokenText && (
            <div className="panel">
              <h2>What the house said</h2>
              <p className="said" style={{ fontSize: 17 }}>
                {spokenText}
              </p>
              {heardText !== spokenText && (
                <p className="faint mono" style={{ fontSize: 12, margin: "10px 0 0" }}>
                  heard as: {heardText}
                </p>
              )}
              {lastVoice && (
                <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  in {VOICE_LABEL[lastVoice]}&rsquo;s voice
                </p>
              )}
            </div>
          )}

          {phase === "over" && result && recording && (
            <Replay log={recording} level={level} result={result} suspicion={suspicion} />
          )}

          {phase === "over" && result && (
            <div className="panel">
              <h2>{result === "won" ? "They left" : "They stopped believing you"}</h2>
              <p className="dim" style={{ margin: "0 0 14px", lineHeight: 1.6, maxWidth: "52ch" }}>
                {result === "won"
                  ? `You talked them off the step with the meter at ${suspicion}. The story held — this time.`
                  : "Something in it stopped adding up, and they heard it."}
              </p>
              <div className="row">
                <button className="primary" onClick={stop}>
                  Another door
                </button>
                <Link href="/spike">
                  <button>Open the spike</button>
                </Link>
              </div>
            </div>
          )}

          {phase === "playing" && (
            <div className="row">
              <button onClick={stop}>Give up</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
