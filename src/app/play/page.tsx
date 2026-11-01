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
import { LEVELS } from "@/game/levels";
import { GROWNUPS } from "@/game/voices";
import { VOICE_KEYS, VOICE_LABEL, type GameEvent, type LevelId, type VoiceId } from "@/lib/events";

type Phase = "ready" | "opening" | "playing" | "over";

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
  const [suspicion, setSuspicion] = useState(0);
  const [result, setResult] = useState<"won" | "caught" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<VoiceId | null>(null);

  const engine = useRef<Engine | null>(null);

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
      case "player_line":
        setHeardText(event.text);
        setSpokenText(event.spokenText);
        setLastVoice(event.voice);
        setPartial("");
        break;
      case "suspicion":
        setSuspicion(event.value);
        break;
      case "mic_state":
        setMicState(event.state);
        if (event.partial !== undefined) setPartial(event.partial);
        break;
      case "level_end":
        setResult(event.result);
        setPhase("over");
        break;
      case "error":
        setError(event.message);
        if (!event.recoverable) setPhase("over");
        break;
    }
  }, []);

  const begin = useCallback(async () => {
    setError(null);
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
  }, []);

  useEffect(() => () => engine.current?.stop(), []);

  // Hold a number key to answer in that voice. Picking the voice and opening
  // the mic are the same motion, because at the door they are the same choice.
  useEffect(() => {
    if (phase !== "playing") return;

    const down = (e: KeyboardEvent) => {
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
            Answer the door
          </button>
        </div>
      )}

      {phase === "opening" && (
        <div className="panel">
          <h2>Opening</h2>
          <p className="dim" style={{ margin: 0 }}>
            Letting the microphone in and warming up the voices&hellip;
          </p>
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
            <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>
              They want {want}.
            </p>
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

          {phase === "over" && (
            <div className="panel">
              <h2>{result === "won" ? "They left" : "Done"}</h2>
              <p className="dim" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
                {result === "won"
                  ? "You talked them off the step. The story held — this time."
                  : "That is as far as this one goes."}
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
