"use client";

/**
 * The replay.
 *
 * The run is already a list of events and a bag of audio, so this does not
 * reconstruct anything, it reads the journal, lays the clips out on one
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

const GAP_MS = 420;

type Beat = {
  id: string;
  who: "visitor" | VoiceId;
  /** whose door this was, a night has several, and they are different people */
  visitorName: string;
  /** the first beat behind this door, so the tape can show where one ends */
  opensDoor: string | null;
  text: string;
  timings: WordTiming[];
  fromExcuseSlot: number | null;
  startSec: number;
  endSec: number;
};

function build(log: RunLog): Beat[] {
  const beats: Beat[] = [];
  let at = 0;
  // A night has several visitors. Without this every line on the tape would
  // be attributed to whoever knocked last.
  let visitorName = "the visitor";
  let brief: string | null = null;

  for (const event of log.events) {
    if (event.type === "level_start") {
      visitorName = event.visitorName;
      brief = event.brief;
      continue;
    }
    if (event.type !== "visitor_line" && event.type !== "player_line") continue;

    const clip = log.clips.get(event.id);
    if (!clip || clip.pcm.length === 0) continue;

    // The clip's own length, not the service's reported duration, this has to
    // line up with what the ear hears, and the samples are the truth.
    const seconds = clip.pcm.length / clip.sampleRate;

    beats.push({
      id: event.id,
      who: event.type === "visitor_line" ? "visitor" : event.voice,
      visitorName,
      opensDoor: brief,
      text: event.type === "visitor_line" ? event.text : event.spokenText,
      timings: event.timings,
      fromExcuseSlot: event.type === "player_line" ? event.fromExcuseSlot : null,
      startSec: at,
      endSec: at + seconds,
    });

    at += seconds + GAP_MS / 1000;
    brief = null; // only the first beat behind a door announces it
  }

  return beats;
}

export default function Replay({
  log,
  result,
  suspicion,
}: {
  log: RunLog;
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
    link.download = "cover-story.wav";
    link.click();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [beats, log]);

  const summary = useCallback(() => {
    const said = beats
      .filter((b) => b.who !== "visitor")
      .map((b) => `${VOICE_LABEL[b.who as VoiceId]}: "${b.text}"`);
    const doors = new Set(beats.map((b) => b.visitorName)).size;

    return [
      `Cover Story, ${doors} ${doors === 1 ? "visitor" : "visitors"}, one night`,
      result === "won"
        ? "Talked every one of them off the step."
        : `Got caught. The meter hit ${suspicion}.`,
      "",
      ...said,
    ].join("\n");
  }, [beats, result, suspicion]);

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
            <div key={beat.id}>
              {beat.opensDoor && <p className="door-mark">{beat.opensDoor}</p>}
              <div className={`beat ${beat.who === "visitor" ? "them" : "us"} ${live ? "live" : ""}`}>
              <span className="who">
                {beat.who === "visitor" ? beat.visitorName : VOICE_LABEL[beat.who as VoiceId]}
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
