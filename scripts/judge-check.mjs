/**
 * The contradiction judgement, measured.
 *
 * Contradiction is the only thing the model scores, and it is worth 26 points,
 * so it is the one prompt in the project that can be wrong in a way the player
 * feels. The two ways of being wrong are not equal: a missed contradiction
 * costs them nothing, a false one punishes them for something they did not do.
 * So MISSES are a disappointment and FALSE POSITIVES are a bug.
 *
 * Every case uses the payload the engine actually sends — each house line is
 * pushed onto `claims` before the next visitor line is asked for, so the newest
 * claim is the one under judgement. Getting that wrong once made a model look
 * worse than it was.
 *
 * Run with the dev server up:  node scripts/judge-check.mjs
 */

const URL = process.env.JUDGE_URL ?? "http://localhost:3200/api/visitor";

const AT_WORK = { voice: "mom", text: "I am at work until about nine tonight." };
const workOpening = [
  { speaker: "visitor", text: "Sorry to knock so late — is your mother in?" },
  { speaker: "mom", text: AT_WORK.text },
  { speaker: "visitor", text: "Oh — so who is at home then?" },
];

/** `expect` is what SHOULD come back. `costly` marks the cases where being
 *  wrong punishes the player rather than letting them off. */
const CASES = [
  {
    name: "she is asleep, not at work",
    expect: true,
    level: "neighbour",
    claims: [AT_WORK, { voice: "dad", text: "She is upstairs asleep, actually." }],
    history: [...workOpening, { speaker: "dad", text: "She is upstairs asleep, actually." }],
  },
  {
    name: "vague about when",
    expect: false,
    costly: true,
    level: "neighbour",
    claims: [AT_WORK, { voice: "mom", text: "I will be back a bit later, I am not sure when." }],
    history: [...workOpening, { speaker: "mom", text: "I will be back a bit later, I am not sure when." }],
  },
  {
    name: "changes the subject",
    expect: false,
    costly: true,
    level: "neighbour",
    claims: [AT_WORK, { voice: "dad", text: "Anyway, did you see the game last night?" }],
    history: [...workOpening, { speaker: "dad", text: "Anyway, did you see the game last night?" }],
  },
  {
    name: "does not know where she is",
    expect: false,
    costly: true,
    level: "neighbour",
    claims: [AT_WORK, { voice: "dad", text: "Honestly I could not tell you where she is right now." }],
    history: [...workOpening, { speaker: "dad", text: "Honestly I could not tell you where she is right now." }],
  },
  {
    name: "she never works evenings",
    expect: true,
    level: "neighbour",
    claims: [AT_WORK, { voice: "uncle", text: "She never works evenings, never has." }],
    history: [...workOpening, { speaker: "uncle", text: "She never works evenings, never has." }],
  },
  {
    name: "garage, then the bath",
    expect: true,
    level: "pizza",
    claims: [
      { voice: "dad", text: "I am out in the garage." },
      { voice: "dad", text: "I am upstairs in the bath." },
    ],
    history: [
      { speaker: "visitor", text: "I just need an adult to sign for it." },
      { speaker: "dad", text: "I am out in the garage." },
      { speaker: "visitor", text: "Can you come to the door then?" },
      { speaker: "dad", text: "I am upstairs in the bath." },
    ],
  },
  {
    name: "two people, two places",
    expect: false,
    costly: true,
    level: "pizza",
    claims: [
      { voice: "dad", text: "I am out in the garage." },
      { voice: "mom", text: "I am upstairs, I will be down in a second." },
    ],
    history: [
      { speaker: "visitor", text: "I just need an adult to sign for it." },
      { speaker: "dad", text: "I am out in the garage." },
      { speaker: "visitor", text: "Is anyone else in?" },
      { speaker: "mom", text: "I am upstairs, I will be down in a second." },
    ],
  },
  {
    name: "same person, same place",
    expect: false,
    costly: true,
    level: "pizza",
    claims: [
      { voice: "dad", text: "I am out in the garage." },
      { voice: "dad", text: "Still in the garage, give me a minute." },
    ],
    history: [
      { speaker: "visitor", text: "I just need an adult to sign for it." },
      { speaker: "dad", text: "I am out in the garage." },
      { speaker: "visitor", text: "Can you come to the door then?" },
      { speaker: "dad", text: "Still in the garage, give me a minute." },
    ],
  },
  {
    name: "alone, then a crowd",
    expect: true,
    level: "neighbour",
    claims: [
      { voice: "mom", text: "It is just me here tonight." },
      { voice: "uncle", text: "There is a whole crowd of us in the kitchen." },
    ],
    history: [
      { speaker: "visitor", text: "Is your mother in?" },
      { speaker: "mom", text: "It is just me here tonight." },
      { speaker: "visitor", text: "Oh, I thought I heard voices." },
      { speaker: "uncle", text: "There is a whole crowd of us in the kitchen." },
    ],
  },
];

let hits = 0;
let misses = 0;
let falsePositives = 0;
const repeats = [];

for (const c of CASES) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: c.level, claims: c.claims, history: c.history }),
  });
  const data = await res.json();
  const found = Boolean(data.contradiction?.found);

  let mark;
  if (found === c.expect) {
    hits++;
    mark = "\x1b[32mok  \x1b[0m";
  } else if (found) {
    falsePositives++;
    mark = "\x1b[31mFALSE\x1b[0m";
  } else {
    misses++;
    mark = "\x1b[33mmiss\x1b[0m";
  }

  // A visitor who repeats one of their own earlier lines word for word reads
  // as broken long before anyone notices a scoring mistake.
  const said = new Set(c.history.filter((h) => h.speaker === "visitor").map((h) => h.text));
  if (said.has(data.text)) repeats.push(c.name);

  console.log(`${mark} ${c.name.padEnd(26)} ${String(found).padEnd(5)} ${data.contradiction?.detail ?? ""}`);
  console.log(`      "${data.text}"`);
}

console.log(`\n${hits}/${CASES.length} correct · ${misses} missed · ${falsePositives} false`);
if (repeats.length) console.log(`repeated its own line: ${repeats.join(", ")}`);
if (falsePositives > 0) {
  console.log("\nA false positive costs the player 26 points for nothing. Fix before shipping.");
  process.exitCode = 1;
}
