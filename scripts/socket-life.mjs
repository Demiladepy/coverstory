/**
 * How long does the transcript socket actually stay up, and why does it go?
 *
 * The game kept dying mid door with the socket closing, and every theory
 * about why was a guess. This asks the service directly, with no microphone
 * and no browser: open a session, feed it exactly what the game feeds it, and
 * print the close code the moment it arrives.
 *
 * Two runs, because the difference between them is the answer:
 *
 *   node scripts/socket-life.mjs silence   what the game does now, 60s of
 *                                          continuous digital silence
 *   node scripts/socket-life.mjs quiet     what the game did before, nothing
 *                                          sent at all after connecting
 *
 * If quiet closes early and silence does not, it is an idle timeout and the
 * fix is right. If both close at the same moment, it is not idle at all and
 * the fix was treating the wrong thing.
 *
 * Reads the key from .env.local and never prints it.
 */
import { readFileSync } from "node:fs";

const mode = ["quiet", "short", "force"].includes(process.argv[2]) ? process.argv[2] : "silence";
const RUN_FOR_MS = Number(process.argv[3] ?? 60_000);

// Strip the byte order mark: the file is UTF-8 with a BOM and it lands on
// the front of the first variable name, so a plain ^NAME match misses it.
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8").replace(/^﻿/, "");
const key = env.match(/^ASSEMBLYAI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim();
if (!key) {
  console.error("No ASSEMBLYAI_API_KEY in .env.local");
  process.exit(1);
}

const SAMPLE_RATE = 16000;
// 50ms of audio per frame, the same shape the browser sends.
const FRAME_SAMPLES = SAMPLE_RATE / 20;

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

// A temporary token, exactly as the browser gets one.
const tokenRes = await fetch(
  `https://streaming.assemblyai.com/v3/token?expires_in_seconds=600`,
  { headers: { Authorization: key } },
);
if (!tokenRes.ok) {
  console.error(`token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
  process.exit(1);
}
const { token } = await tokenRes.json();
console.log(`[${since()}] got a temporary token`);

const params = new URLSearchParams({
  token,
  sample_rate: String(SAMPLE_RATE),
  encoding: "pcm_s16le",
});
const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`);
ws.binaryType = "arraybuffer";

let timer = null;
let framesSent = 0;

ws.onopen = () => {
  console.log(`[${since()}] open, mode=${mode}`);
  if (mode === "quiet") {
    console.log(`[${since()}] sending nothing at all, waiting to be hung up on`);
    return;
  }
  // The question this answers: does one undersized chunk kill the session?
  // The browser flushes a part filled buffer whenever the push to talk key
  // changes state, and that buffer can hold a couple of milliseconds.
  if (mode === "short") {
    const normal = new Int16Array(FRAME_SAMPLES);
    ws.send(normal.buffer);
    ws.send(normal.buffer);
    const tiny = new Int16Array(32); // 2ms at 16kHz, well under the minimum
    console.log(`[${since()}] sending one 2ms chunk`);
    ws.send(tiny.buffer);
    timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(normal.buffer);
      framesSent++;
      if (framesSent % 100 === 0) console.log(`[${since()}] still up after the short one`);
    }, 50);
    return;
  }

  // What the game does on every single key release: a second of audio, then
  // ForceEndpoint to close the turn. If this is what hangs up on us, it is
  // the one message the game cannot avoid sending.
  if (mode === "force") {
    const normal = new Int16Array(FRAME_SAMPLES);
    let n = 0;
    timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(normal.buffer);
      n++;
      framesSent++;
      // every 20 frames is one second: talk for a second, then force the turn
      if (n % 20 === 0) {
        console.log(`[${since()}] ForceEndpoint #${n / 20}`);
        ws.send(JSON.stringify({ type: "ForceEndpoint" }));
      }
    }, 50);
    return;
  }

  const silence = new Int16Array(FRAME_SAMPLES);
  timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(silence.buffer);
    framesSent++;
    if (framesSent % 100 === 0) console.log(`[${since()}] still up, ${framesSent} frames sent`);
  }, 50);
};

ws.onmessage = (event) => {
  if (typeof event.data !== "string") return;
  const msg = JSON.parse(event.data);
  if (msg.type === "Begin") console.log(`[${since()}] Begin, session ${msg.id}`);
  else if (msg.type === "Error") console.log(`[${since()}] ERROR from service:`, msg.error);
  else if (msg.type !== "Turn") console.log(`[${since()}] ${msg.type}`);
};

ws.onerror = () => console.log(`[${since()}] socket error`);

ws.onclose = (event) => {
  if (timer) clearInterval(timer);
  console.log(
    `[${since()}] CLOSED code=${event.code} reason=${JSON.stringify(event.reason)} ` +
      `wasClean=${event.wasClean} framesSent=${framesSent}`,
  );
  process.exit(0);
};

setTimeout(() => {
  if (timer) clearInterval(timer);
  console.log(`[${since()}] still alive after the full run, closing on purpose`);
  ws.close();
  process.exit(0);
}, RUN_FOR_MS);
