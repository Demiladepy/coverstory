"use client";

/**
 * The replay.
 *
 * The run is already a list of events and a bag of audio, so this does not
 * reconstruct anything — it reads the journal, lays the clips out on one
 * timeline and follows the word timings that came back with each line.
 *
 * Captions are the reason the word boundaries were worth chasing in the first
 * place. Hearing your own stammer come out of a tired father is funny; watching
 * the word light up as he says it is what makes it screenshot-able, and a
 * screenshot is what gets shared.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, playClip, stitch } from "@/lib/wav";
import { VOICE_LABEL, type LevelResult, type RunLog, type VoiceId, type WordTiming } from "@/lib/events";
import type { Level } from "@/game/levels";

const GAP_MS = 420;

type Beat = {
  id: string;
  who: "visitor" | VoiceId;
  text: string;
  timings: WordTiming[];
  fromExcuseSlot: number | null;
  startSec: number;
  endSec: number;
};

function build(log: RunLog): Beat[] {
  const beats: Beat[] = [];
  let at = 0;

  for (const event of log.events) {
    if (event.type !== "visitor_line" && event.type !== "player_line") continue;

    const clip = log.clips.get(event.id);
    if (!clip || clip.pcm.length === 0) continue;

    // The clip's own length, not the service's reported duration — this has to
    // line up with what the ear hears, and the samples are the truth.
    const seconds = clip.pcm.length / clip.sampleRate;

    beats.push({
      id: event.id,
      who: event.type === "visitor_line" ? "visitor" : event.voice,
      text: event.type === "visitor_line" ? event.text : event.spokenText,
      timings: event.timings,
      fromExcuseSlot: event.type === "player_line" ? event.fromExcuseSlot : null,
      startSec: at,
      endSec: at + seconds,
    });

    at += seconds + GAP_MS / 1000;
  }

  return beats;
}

export default function Replay({
  log,
  level,
  result,
  suspicion,
}: {
  log: RunLog;
  level: Level;
  result: LevelResult;
  suspicion: number;
}) {
  const [beats] = useState(() => build(log));
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(-1);
  const [copied, setCopied] = useState(false);

  const ctx = useRef<AudioContext | null>(null);
  const startedAt = useRef(0);
  const frame = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    void ctx.current?.close();
    ctx.current = null;
    setPlaying(false);
    setNow(-1);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(() => {
    if (beats.length === 0) return;
    stop();

    const audio = new AudioContext();
    ctx.current = audio;
    const begin = audio.currentTime + 0.08;
    startedAt.current = begin;

    for (const beat of beats) {
      const clip = log.clips.get(beat.id);
      if (clip) playClip(audio, clip, begin + beat.startSec);
    }

    setPlaying(true);

    const tick = () => {
      if (!ctx.current) return;
      const t = ctx.current.currentTime - startedAt.current;
      setNow(t);
      if (t > beats[beats.length - 1].endSec + 0.3) {
        stop();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [beats, log, stop]);

  const download = useCallback(() => {
    const clips = beats.map((b) => log.clips.get(b.id)).filter((c) => c !== undefined);
    const blob = encodeWav(stitch(clips, GAP_MS));
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `cover-story-${level.id}.wav`;
    link.click();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [beats, log, level]);

  const summary = useCallback(() => {
    const said = beats
      .filter((b) => b.who !== "visitor")
      .map((b) => `${VOICE_LABEL[b.who as VoiceId]}: "${b.text}"`);

    return [
      `Cover Story — ${level.brief}`,
      result === "won"
        ? `Talked them off the step with the meter at ${suspicion}.`
        : `Got caught. The meter hit ${suspicion}.`,
      "",
      ...said,
    ].join("\n");
  }, [beats, level, result, suspicion]);

  const share = useCallback(async () => {
    const text = summary();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Cover Story", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // A cancelled share and a blocked clipboard look the same from here, and
      // neither is worth an error message.
    }
  }, [summary]);

  if (beats.length === 0) return null;

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p className="title">The tape</p>
        <span className="clock">
          {Math.round(beats[beats.length - 1].endSec)}s · {beats.length} lines
        </span>
      </div>

      <div className="tape">
        {beats.map((beat) => {
          const live = now >= beat.startSec && now <= beat.endSec;
          const insideMs = (now - beat.startSec) * 1000;

          return (
            <div key={beat.id} className={`beat ${beat.who === "visitor" ? "them" : "us"} ${live ? "live" : ""}`}>
              <span className="who">
                {beat.who === "visitor" ? level.visitorName : VOICE_LABEL[beat.who as VoiceId]}
                {beat.fromExcuseSlot !== null && <em> · prepared</em>}
              </span>
              <p className="words">
                {beat.timings.length > 0
                  ? beat.timings.map((word, i) => (
                      <span
                        key={`${beat.id}-${i}`}
                        className={live && insideMs >= word.start && insideMs <= word.end ? "lit" : ""}
                      >
                        {word.text}{" "}
                      </span>
                    ))
                  : beat.text}
              </p>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="go" onClick={playing ? stop : play}>
          {playing ? "Stop" : "Play it back"}
        </button>
        <button className="quiet" onClick={download}>
          Download the tape
        </button>
        <button className="quiet" onClick={() => void share()}>
          {copied ? "Copied" : "Share"}
        </button>
      </div>
    </div>
  );
}
