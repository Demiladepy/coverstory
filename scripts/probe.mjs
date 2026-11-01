/**
 * The half of the day-one spike that needs no microphone.
 *
 * The browser spike measures the whole gap a player feels. This measures the
 * part that doesn't need a human: how long AssemblyAI takes to start speaking,
 * whether word timings come back, how much a cold voice costs on first use,
 * and which Gateway model is fast enough to run a visitor's brain.
 *
 *   node scripts/probe.mjs
 */

import { readFileSync } from "node:fs";

function loadKey() {
  if (process.env.ASSEMBLYAI_API_KEY) return process.env.ASSEMBLYAI_API_KEY;
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = env.match(/^ASSEMBLYAI_API_KEY=(.+)$/m);
  if (!match) throw new Error("no ASSEMBLYAI_API_KEY in .env.local");
  return match[1].trim();
}

const KEY = loadKey();
const auth = { Authorization: KEY };

const ms = (n) => `${Math.round(n)} ms`;
const pad = (s, n) => String(s).padEnd(n);

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
  console.log("─".repeat(text.length));
}

/** Speak one line and time the first audio out of the door. */
async function speak(text, voiceId) {
  const started = performance.now();

  const res = await fetch("https://tts.us.assemblyai.com/v1/speech/events", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId, language: "english" }),
  });

  if (!res.ok) {
    return { error: `${res.status} ${(await res.text()).slice(0, 160)}` };
  }

  let firstAudioMs = -1;
  let bytes = 0;
  let durationMs = 0;
  let words = null;
  let billed = 0;
  let config = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let event = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith(":") || line.trim() === "") continue;
      if (line.startsWith("event: ")) { event = line.slice(7).trim(); continue; }
      if (!line.startsWith("data: ")) continue;

      const data = JSON.parse(line.slice(6));
      if (event === "Begin") config = data.configuration;
      else if (event === "Audio") {
        if (firstAudioMs < 0) firstAudioMs = performance.now() - started;
        bytes += Buffer.from(data.audio, "base64").length;
      } else if (event === "FlushDone") durationMs = data.audio_duration_ms;
      else if (event === "WordBoundaries") words = data.words;
      else if (event === "Termination") billed = data.billed_characters ?? 0;
      else if (event === "Error") return { error: `${data.code}: ${data.message}` };
    }
  }

  return {
    firstAudioMs,
    completeMs: performance.now() - started,
    bytes,
    durationMs,
    words,
    billed,
    config,
  };
}

async function tokens() {
  heading("Tokens");

  for (const [name, url] of [
    ["STT", "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=240"],
    ["TTS", "https://token.us.assemblyai.com/v1/token?product=tts&expires_in_seconds=60&max_session_duration_seconds=240"],
  ]) {
    const started = performance.now();
    const res = await fetch(url, { headers: auth });
    const elapsed = performance.now() - started;
    if (!res.ok) {
      console.log(`  ${pad(name, 5)} \x1b[31mFAILED\x1b[0m ${res.status} ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    const data = await res.json();
    console.log(`  ${pad(name, 5)} ok in ${pad(ms(elapsed), 9)} token ${String(data.token).slice(0, 12)}…`);
  }
}

async function voices() {
  heading("Time to first audio, by voice");
  console.log("  The three grown-ups are on the critical path. Built-in voices are");
  console.log("  always loaded; a catalog voice is loaded on first use.\n");
  console.log(`  ${pad("voice", 16)}${pad("kind", 10)}${pad("cold", 11)}${pad("warm", 11)}${pad("audio", 10)}timings`);

  const line = "Hey, hang on a second, I'm coming.";

  const cast = [
    ["aai-paul", "built-in", "Dad"],
    ["aai-mary", "built-in", "Mom"],
    ["aai-george", "built-in", "Uncle"],
    ["aai-dorsey", "catalog", "a visitor"],
  ];

  const results = [];

  for (const [voiceId, kind, role] of cast) {
    const cold = await speak(line, voiceId);
    if (cold.error) {
      console.log(`  ${pad(voiceId, 16)}\x1b[31m${cold.error}\x1b[0m`);
      continue;
    }
    const warm = await speak(line, voiceId);

    const timings = cold.words ? `${cold.words.length} words` : "\x1b[31mnone\x1b[0m";
    console.log(
      `  ${pad(voiceId, 16)}${pad(kind, 10)}${pad(ms(cold.firstAudioMs), 11)}` +
      `${pad(ms(warm.firstAudioMs), 11)}${pad(ms(cold.durationMs), 10)}${timings}`,
    );
    results.push({ voiceId, kind, role, cold: cold.firstAudioMs, warm: warm.firstAudioMs, words: cold.words });
  }

  const sample = results.find((r) => r.words?.length);
  if (sample) {
    console.log(`\n  Word timings look like this (${sample.voiceId}):`);
    for (const w of sample.words.slice(0, 6)) {
      console.log(`    ${pad(w.word, 12)} ${pad(w.start, 6)}→${pad(w.end, 7)} conf ${w.confidence?.toFixed?.(2) ?? "-"}`);
    }
  }

  return results;
}

async function prosody() {
  heading("Does the shout trick survive synthesis?");
  console.log("  The player shouts, we write the loud words in CAPS and give the line");
  console.log("  a rising tail. If the audio gets longer or louder, the trick works.\n");

  const pairs = [
    ["flat", "Dad says you need to come back later."],
    ["shouted", "Dad says you need to come back LATER."],
    ["surprised", "Dad says you need to come back later?!"],
  ];

  for (const [label, text] of pairs) {
    const out = await speak(text, "aai-paul");
    if (out.error) { console.log(`  ${pad(label, 12)}\x1b[31m${out.error}\x1b[0m`); continue; }
    console.log(`  ${pad(label, 12)}${pad(ms(out.durationMs), 11)}${pad(`${out.bytes} B`, 12)}first audio ${ms(out.firstAudioMs)}`);
  }
}

async function brain() {
  heading("Visitor brain, on the LLM Gateway");
  console.log("  One turn of a real encounter, asking for the structured flags the");
  console.log("  suspicion rules need. Speed matters more than depth here.\n");

  const system =
    "You are a pizza driver at the door of a house at 8pm. You need an adult to pay and " +
    "sign for the order. You are being answered by a voice claiming to be the father. " +
    "Reply in character with ONE short spoken sentence, then judge the answer. " +
    'Return only JSON: {"line": string, "flags": {"evasive": boolean, "contradiction": boolean, ' +
    '"childlike": boolean, "confident": boolean}, "satisfied": boolean}';

  const user =
    'The adult voice said: "uh, yeah, hi, my dad- I mean, I am the dad, just leave it at the door."';

  // Cheap and fast first — a visitor's turn is a short reply and four
  // booleans, so there is nothing here worth paying a frontier model for.
  // Some ids the docs list are gated per account, which only a call reveals.
  const models = [
    "qwen3.5-4b-32k-fast",
    "mercury-voice",
    "nemotron-lightning-3p5-30b-a3b",
    "nemotron-nano-9b-v2",
    "gpt-5-nano",
    "claude-haiku-5-5",
    "gpt-oss-20b",
    "gemma-4-31b",
    "glm-5.3-flash",
    "gemini-2.5-flash-lite",
  ];

  const schema = {
    type: "object",
    properties: {
      line: { type: "string" },
      flags: {
        type: "object",
        properties: {
          evasive: { type: "boolean" },
          contradiction: { type: "boolean" },
          childlike: { type: "boolean" },
          confident: { type: "boolean" },
        },
        required: ["evasive", "contradiction", "childlike", "confident"],
      },
      satisfied: { type: "boolean" },
    },
    required: ["line", "flags", "satisfied"],
  };

  const working = [];

  for (const model of models) {
    const started = performance.now();
    try {
      const res = await fetch("https://llm-gateway.assemblyai.com/v1/chat/completions", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: 300,
          response_format: {
            type: "json_schema",
            json_schema: { name: "visitor_turn", strict: true, schema },
          },
        }),
      });
      const elapsed = performance.now() - started;

      if (!res.ok) {
        const body = await res.text();
        const gated = body.includes("does not have access");
        const label = gated ? "no access" : body.includes("not supported") ? "unknown id" : `${res.status}`;
        console.log(`  ${pad(model, 32)}${pad("", 10)}\x1b[31m${label}\x1b[0m`);
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      const match = content.match(/\{[\s\S]*\}/);
      let parsed = null;
      try { parsed = match ? JSON.parse(match[0]) : null; } catch { /* reported below */ }

      const verdict = parsed ? "\x1b[32mJSON ok\x1b[0m" : "\x1b[31mnot JSON\x1b[0m";
      console.log(`  ${pad(model, 32)}${pad(ms(elapsed), 10)}${verdict}`);
      if (parsed) {
        working.push({ model, elapsed, parsed });
        console.log(`    \x1b[2m"${parsed.line}"\x1b[0m`);
        console.log(`    \x1b[2m${JSON.stringify(parsed.flags)} satisfied=${parsed.satisfied}\x1b[0m`);
      } else {
        console.log(`    \x1b[2m${content.slice(0, 110).replace(/\n/g, " ")}\x1b[0m`);
      }
    } catch (err) {
      console.log(`  ${pad(model, 32)}\x1b[31m${err.message}\x1b[0m`);
    }
  }

  if (working.length) {
    working.sort((a, b) => a.elapsed - b.elapsed);
    console.log(`\n  Fastest that returns usable JSON: \x1b[1m${working[0].model}\x1b[0m at ${ms(working[0].elapsed)}`);
  } else {
    console.log("\n  \x1b[31mNothing usable. The visitor's brain has no model to run on.\x1b[0m");
  }

  return working;
}

async function budget() {
  heading("What a run costs");
  const out = await speak(
    "Evening. I've got an order here for this address, large pepperoni. " +
    "I just need an adult to sign for it.",
    "aai-dorsey",
  );
  if (out.error) { console.log(`  \x1b[31m${out.error}\x1b[0m`); return; }

  const perRun = 2000;
  console.log(`  one visitor line: ${out.billed} characters, ${ms(out.durationMs)} of audio`);
  console.log(`  a ${perRun}-character run at $15 per million: $${((perRun * 15) / 1e6).toFixed(4)}`);
}

async function main() {
  console.log("\x1b[1mCover Story — API probe\x1b[0m");
  console.log(new Date().toISOString());

  if (process.argv[2] && process.argv[2] !== "all") { if (process.argv[2] === "brain") { await brain(); return; } if (process.argv[2] === "voices") { await voices(); return; } }
  await tokens();
  const voiceResults = await voices();
  await prosody();
  await brain();
  await budget();

  heading("What this means for the loop");
  const grownups = voiceResults.filter((r) => r.kind === "built-in" && r.warm > 0);
  if (grownups.length) {
    const warm = grownups.map((r) => r.warm).sort((a, b) => a - b);
    const median = warm[Math.floor(warm.length / 2)];
    console.log(`  Speaking an adult line takes about ${ms(median)} once warm.`);
    console.log(`  The browser spike adds the transcript half on top of that.`);
    console.log(`  Budget for the whole gap is 1500 ms, so the transcript has`);
    console.log(`  roughly ${ms(1500 - median)} before the loop feels slow.`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\n\x1b[31m${err.stack ?? err.message}\x1b[0m`);
  process.exit(1);
});
