"use client";

/**
 * Day-one spike.
 *
 * Three questions, and the answers decide the rest of the build:
 *
 *  1. How long is the gap between letting go of the key and hearing the adult
 *     voice? The plan budgets 1.5 s. Over that and visitor lines get shorter,
 *     the Gateway model gets faster and the dead-air grace window gets longer.
 *  2. Does the realtime transcript keep hesitations? A re-voiced line only
 *     sounds human if the "uh"s survive. `format_turns` exists on Universal
 *     Streaming only, so the comparison here is between speech models, not
 *     between formatted and unformatted on one.
 *  3. Does a shout register? The mic's loudness track has to separate a raised
 *     voice from a normal one, or the CAPS trick has nothing to fire on.
 *
 * This is not throwaway. Every piece it exercises — tokens, the STT socket,
 * ForceEndpoint, re-voicing over HTTP, word timings — is the core loop, and the
 * numbers it prints go straight into the README.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { startMic, type Mic } from "@/lib/mic";
import { openStt, type SttSession, type SttTurn } from "@/lib/stt";
import { speakLine } from "@/lib/speak";
import { GROWNUPS } from "@/game/voices";
import type { VoiceId } from "@/lib/events";

type Model = "universal-3-6-pro" | "universal-streaming-english";

type Measurement = {
  n: number;
  heldMs: number;
  /** key release -> final turn from the transcript */
  finaliseMs: number;
  /** final turn -> first adult audio playing */
  speakMs: number;
  /** the number that matters: release -> adult voice */
  gapMs: number;
  transcript: string;
  fillers: string[];
  shouted: boolean;
  peak: number;
  baseline: number;
  model: Model;
  voice: VoiceId;
};

const FILLER = /\b(uh+|um+|erm|er|ah+|hmm+|mhm|huh)\b/gi;

function findFillers(text: string): string[] {
  return text.match(FILLER) ?? [];
}

function ms(n: number) {
  return `${Math.round(n)}`;
}

export default function Spike() {
  const [status, setStatus] = useState("Not started.");
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [holding, setHolding] = useState(false);
  const [partial, setPartial] = useState("");
  const [model, setModel] = useState<Model>("universal-3-6-pro");
  const [voice, setVoice] = useState<VoiceId>("dad");
  const [rows, setRows] = useState<Measurement[]>([]);
  const [sttConfig, setSttConfig] = useState<Record<string, unknown> | null>(null);

  const mic = useRef<Mic | null>(null);
  const stt = useRef<SttSession | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const ttsToken = useRef<string>("");
  const pressedAt = useRef(0);
  const releasedAt = useRef(0);
  const turnStartMs = useRef(0);
  const counter = useRef(0);
  const busy = useRef(false);

  // Keep the live values readable from the socket callback without making the
  // socket depend on them and reconnect every time a dropdown changes.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const modelRef = useRef(model);
  modelRef.current = model;

  const teardown = useCallback(() => {
    stt.current?.terminate();
    stt.current = null;
    mic.current?.stop();
    mic.current = null;
    setArmed(false);
    setHolding(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  const onTurn = useCallback(async (turn: SttTurn) => {
    if (!turn.transcript.trim()) {
      setStatus("Nothing came through — try again, a little louder.");
      busy.current = false;
      return;
    }

    const finaliseMs = performance.now() - releasedAt.current;

    // Loudness over the words of this turn, against how loud this speaker
    // usually is. Word times are on the session timeline, same as the track.
    const first = turn.words[0]?.start ?? turnStartMs.current;
    const last = turn.words[turn.words.length - 1]?.end ?? first + 1000;
    const peak = mic.current?.loudnessBetween(first, last) ?? 0;
    const baseline = mic.current?.baseline() ?? 0.05;

    setPartial("");
    setStatus("Re-voicing…");

    const grownup = GROWNUPS.find((g) => g.id === voiceRef.current)!;

    try {
      const spoken = await speakLine({
        ctx: ctx.current!,
        token: ttsToken.current,
        text: turn.transcript,
        voiceId: grownup.voiceId,
      });

      counter.current += 1;
      setRows((prev) => [
        {
          n: counter.current,
          heldMs: releasedAt.current - pressedAt.current,
          finaliseMs,
          speakMs: spoken.firstAudioMs,
          gapMs: finaliseMs + spoken.firstAudioMs,
          transcript: turn.transcript,
          fillers: findFillers(turn.transcript),
          shouted: peak > baseline * 1.7,
          peak,
          baseline,
          model: modelRef.current,
          voice: voiceRef.current,
        },
        ...prev,
      ]);
      setStatus("Hold the key and talk.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "re-voicing failed");
      setStatus("Re-voicing failed.");
    } finally {
      busy.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus("Minting tokens…");

    try {
      const res = await fetch("/api/token", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `token request failed (${res.status})`);
      }
      const tokens = (await res.json()) as { stt: string; tts: string };
      ttsToken.current = tokens.tts;

      // Created inside the click so the browser lets it make sound.
      ctx.current = new AudioContext({ sampleRate: 24000 });
      await ctx.current.resume();

      setStatus("Opening the transcript…");
      const session = await openStt({
        token: tokens.stt,
        speechModel: model,
        // Only Universal Streaming reads this; the pro models ignore it.
        ...(model === "universal-streaming-english" ? { formatTurns: false } : {}),
        onBegin: (info) => setSttConfig(info.configuration),
        onPartial: setPartial,
        onTurn: (turn) => void onTurn(turn),
        onError: (message) => setError(message),
      });
      stt.current = session;

      setStatus("Opening the mic…");
      mic.current = await startMic((frame) => stt.current?.send(frame.pcm));

      setArmed(true);
      setStatus("Hold the key and talk.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start");
      setStatus("Stopped.");
      teardown();
    }
  }, [model, onTurn, teardown]);

  // Push to talk. Space is held down, not toggled, so the release is the
  // signal — exactly what ForceEndpoint wants.
  useEffect(() => {
    if (!armed) return;

    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || holding || busy.current) return;
      e.preventDefault();
      pressedAt.current = performance.now();
      turnStartMs.current = mic.current?.elapsedMs() ?? 0;
      setHolding(true);
      setPartial("");
      setStatus("Listening…");
    };

    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !holding) return;
      e.preventDefault();
      releasedAt.current = performance.now();
      busy.current = true;
      setHolding(false);
      setStatus("Finalising…");
      stt.current?.forceEndpoint();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [armed, holding]);

  const gaps = rows.map((r) => r.gapMs);
  const median = gaps.length
    ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : 0;
  const withFillers = rows.filter((r) => r.fillers.length > 0).length;

  return (
    <main className="wrap">
      <h1>Day-one spike</h1>
      <p className="sub">
        Hold <strong>Space</strong>, say something with an &ldquo;uh&rdquo; in it, let go. The line comes
        back in a grown-up voice. Three numbers come out of this: how long the gap is, whether
        the hesitations survive, and whether a shout reads as a shout.
      </p>

      {error && (
        <div className="panel err">
          <h2 style={{ color: "inherit" }}>Error</h2>
          <div className="mono">{error}</div>
        </div>
      )}

      <div className="panel">
        <h2>Setup</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <label className="pick">
            Model
            <select
              className="mono"
              value={model}
              disabled={armed}
              onChange={(e) => setModel(e.target.value as Model)}
              style={{ background: "var(--panel-2)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px" }}
            >
              <option value="universal-3-6-pro">universal-3-6-pro (default)</option>
              <option value="universal-streaming-english">universal-streaming-english, format_turns=false</option>
            </select>
          </label>

          <span className="faint">·</span>

          {GROWNUPS.map((g) => (
            <button
              key={g.id}
              className={voice === g.id ? "on" : ""}
              onClick={() => setVoice(g.id)}
              title={g.note}
            >
              {g.key} · {g.label}
            </button>
          ))}
        </div>

        <div className="row">
          {!armed ? (
            <button className="primary" onClick={() => void start()}>
              Start — allow the mic
            </button>
          ) : (
            <button onClick={teardown}>Stop</button>
          )}
          <span className="dim mono">{status}</span>
        </div>

        {sttConfig && (
          <div className="mono faint" style={{ marginTop: 12 }}>
            session: {JSON.stringify(sttConfig)}
          </div>
        )}
      </div>

      <div className={`talk ${holding ? "live" : ""}`} style={{ marginBottom: 16, textAlign: "center" }}>
        {!armed
          ? "Start above, then hold Space"
          : holding
            ? "● Listening — let go when you're done"
            : "Hold Space to talk"}
        <div className="mono dim" style={{ marginTop: 10, fontWeight: 400, minHeight: 20 }}>
          {partial || " "}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="panel">
            <h2>Release to adult voice</h2>
            <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
              <span className={`big ${median <= 1500 ? "good" : "bad"}`}>{ms(median)} ms</span>
              <span className="dim">median over {rows.length} turn{rows.length === 1 ? "" : "s"}</span>
            </div>
            <p className="verdict dim">
              {median <= 1200 ? (
                <>Comfortably inside the budget. The loop can stay as designed.</>
              ) : median <= 1500 ? (
                <>Inside the 1.5 s budget, but not by much. Keep visitor lines to one sentence.</>
              ) : (
                <>
                  Over budget. The fallbacks in the plan apply: shorter visitor lines, a faster
                  Gateway model, and a longer dead-air grace window tuned to this number.
                </>
              )}
            </p>
          </div>

          <div className="panel">
            <h2>Hesitations</h2>
            <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
              <span className={`big ${withFillers > 0 ? "good" : "bad"}`}>
                {withFillers}/{rows.length}
              </span>
              <span className="dim">turns kept at least one filler</span>
            </div>
            <p className="verdict dim">
              {withFillers > 0 ? (
                <>
                  They survive on <span className="mono">{rows[0].model}</span>. The re-voiced line
                  will sound human.
                </>
              ) : (
                <>
                  Nothing kept so far. Say a deliberate &ldquo;uhh&rdquo; and check again; if they still
                  vanish, switch the model above and compare before writing game code.
                </>
              )}
            </p>
          </div>

          <div className="panel">
            <h2>Every turn</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>held</th>
                  <th>finalise</th>
                  <th>speak</th>
                  <th>gap</th>
                  <th>fillers</th>
                  <th>shout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n}>
                    <td className="faint">{r.n}</td>
                    <td>{ms(r.heldMs)}</td>
                    <td>{ms(r.finaliseMs)}</td>
                    <td>{ms(r.speakMs)}</td>
                    <td className={r.gapMs <= 1500 ? "good" : "bad"}>{ms(r.gapMs)}</td>
                    <td className={r.fillers.length ? "warm" : "faint"}>
                      {r.fillers.length ? r.fillers.join(" ") : "—"}
                    </td>
                    <td className={r.shouted ? "warm" : "faint"}>
                      {r.shouted ? "yes" : "no"} ({r.peak.toFixed(2)}/{r.baseline.toFixed(2)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              finalise = key release to the final transcript · speak = transcript to the first
              adult audio playing · gap = the two together, which is what the player feels.
            </p>
          </div>

          <div className="panel">
            <h2>Last transcript, as the house heard it</h2>
            <div
              className="transcript"
              dangerouslySetInnerHTML={{
                __html: rows[0].transcript.replace(FILLER, (m) => `<mark>${m}</mark>`),
              }}
            />
          </div>
        </>
      )}
    </main>
  );
}
