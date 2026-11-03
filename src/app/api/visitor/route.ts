import { NextResponse } from "next/server";
import { chat, extractJson } from "@/lib/aai";
import { LEVEL_BY_ID, type Level } from "@/game/levels";
import { VOICE_LABEL, type LevelId, type VoiceId } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The visitor's next line, and the one judgement the model is trusted with.
 *
 * These were one call for a while, on the theory that they are the same
 * thought: a visitor notices the thing that does not add up and *then* decides
 * what to ask. It reads well and it scored badly. Measured over the nine cases
 * in scripts/judge-check.mjs, the combined call kept flagging contradictions
 * that were not there — a grown-up being vague, or admitting they did not
 * know, came back as a clash.
 *
 * The reason is the premise. A character whose whole job is to catch you out,
 * asked in the same breath to judge impartially, will find something; and the
 * character wants a high temperature for variety while the judgement wants a
 * low one for consistency. One call cannot have both.
 *
 * So they are two calls now, fired together so the round trip is unchanged:
 *
 *   - the line, in character, hot, which is what makes the visitor good;
 *   - the judgement, with no persona at all, cold, which is what makes the
 *     meter fair.
 *
 * The cost is that the visitor's line cannot react to a contradiction it was
 * not told about. It still has the claims in front of it and often notices
 * anyway, and a meter that moves for the right reason is worth more than a
 * line that gloats.
 */

type Body = {
  level: LevelId;
  history: { speaker: string; text: string }[];
  /** what the adults of this house have claimed out loud, oldest first */
  claims?: { voice: string; text: string }[];
  /** open the connection and wake the model, throwing the answer away */
  warm?: boolean;
};

type Written = { line: string; addressed_to: string | null };
type Judged = { contradicts?: boolean; what?: string };

/** If the model falls over, the visitor still has to say something. */
const PROD = [
  "Sorry — say that again?",
  "I didn't catch that. Who am I speaking to?",
  "Right. And you are?",
];

function who(voice: string): string {
  return VOICE_LABEL[voice as VoiceId] ?? "someone";
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // The first completion of a run costs about three seconds and every one after
  // it costs one. That first one would land on the player's first answer, which
  // is the worst place for it, so it is spent here instead — during the
  // visitor's opening line, where there is four seconds of audio to hide in.
  if (body.warm) {
    await chat({ messages: [{ role: "user", content: "ok" }], maxTokens: 1 }).catch(() => {});
    return NextResponse.json({ warmed: true });
  }

  const level = LEVEL_BY_ID[body.level];
  if (!level) return NextResponse.json({ error: "unknown_level" }, { status: 400 });

  const claims = (body.claims ?? []).slice(-8);

  const [line, judgement] = await Promise.all([
    writeLine(body, level, claims).catch(() => null),
    judge(claims).catch(() => null),
  ]);

  if (!line) {
    const text = PROD[Math.min(body.history.length >> 1, PROD.length - 1)];
    return NextResponse.json({ text, addressedTo: null, contradiction: null, fallback: true });
  }

  return NextResponse.json({ ...line, contradiction: judgement });
}

/** The character. Hot, because a visitor who repeats themselves is no fun. */
async function writeLine(
  body: Body,
  level: Level,
  claims: { voice: string; text: string }[],
) {
  const system = [
    `You are ${level.visitorName}, at the door of a family home.`,
    level.persona,
    ``,
    `What you want: ${level.want}.`,
    ``,
    `How you speak:`,
    `- One or two short sentences. This is said out loud, so no stage directions,`,
    `  no asterisks, no emoji, no narration.`,
    `- You are a person. Never mention being an AI, a model, a character or a game.`,
    `- Press for what you want. If the last answer dodged your question, ask it`,
    `  again in plainer words rather than moving on.`,
    `- Never repeat a line you have already said. Asking the same thing twice`,
    `  word for word is the one thing a real person at a door never does.`,
    `- Never accuse anyone of being a child, and never say the word "child". If`,
    `  something feels off, ask an ordinary question about it instead.`,
    `- The adults in this house are ${Object.values(VOICE_LABEL).join(", ")}. Only`,
    `  address one by name once you have reason to think they are there.`,
    ...(claims.length
      ? [
          ``,
          `This house has already told you:`,
          ...claims.map((c) => `- ${who(c.voice)}: "${c.text}"`),
        ]
      : []),
    ``,
    `Answer as JSON and nothing else:`,
    `{"line": "<what you say>", "addressed_to": "dad" | "mom" | "uncle" | null}`,
    `Set "addressed_to" when you are speaking to one grown-up in particular,`,
    `otherwise null.`,
  ].join("\n");

  // The visitor's own lines are the assistant's; everything the house said back
  // is the user's, labelled with which grown-up supposedly said it.
  const messages = [
    { role: "system" as const, content: system },
    ...body.history.slice(-10).map((turn) =>
      turn.speaker === "visitor"
        ? { role: "assistant" as const, content: turn.text }
        : { role: "user" as const, content: `[${who(turn.speaker)}] ${turn.text}` },
    ),
  ];

  const result = await chat({ messages, json: true, maxTokens: 160, temperature: 0.9 });
  const written = extractJson<Written>(result.content);
  const text = written?.line?.trim();
  if (!text) throw new Error("no line");

  const to = written?.addressed_to;
  const addressedTo: VoiceId | null = to === "dad" || to === "mom" || to === "uncle" ? to : null;

  return { text, addressedTo, latencyMs: result.latencyMs };
}

/**
 * The judgement. No persona, no stake in the answer, temperature zero.
 *
 * The exclusions are listed last and at length because the expensive mistake
 * is the false one: a missed contradiction costs the player nothing, and a
 * wrong one takes 26 points off them for something they did not do.
 */
async function judge(claims: { voice: string; text: string }[]) {
  if (claims.length < 2) return { found: false };

  const numbered = claims.map((c, i) => `${i + 1}. ${who(c.voice)}: "${c.text}"`);

  const system = [
    `You check statements for contradictions. You are not a character and you`,
    `have no stake in the answer.`,
    ``,
    `Everyone in this house is a different person: Dad, Mom and Uncle can each`,
    `be somewhere different without any conflict.`,
    ``,
    `Answer true only if the LAST statement cannot be true at the same time as`,
    `an earlier one. Nothing else counts. In particular, none of the following`,
    `is a contradiction:`,
    `- being vague, or not giving a time`,
    `- not knowing, not being sure, or not being able to say`,
    `- changing the subject, or not answering`,
    `- a different person being somewhere else`,
    `- saying more, or less, than before about the same thing`,
    ``,
    `Two statements about the same person in different places, or the same`,
    `fact told two different ways, do clash — say so plainly when they do.`,
    ``,
    `Answer as JSON and nothing else:`,
    `{"contradicts": true | false, "what": "<the two statements that clash>"}`,
  ].join("\n");

  const result = await chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: numbered.join("\n") },
    ],
    json: true,
    maxTokens: 120,
    temperature: 0,
  });

  const verdict = extractJson<Judged>(result.content);
  const found = Boolean(verdict?.contradicts);
  return { found, detail: found ? verdict?.what?.trim() : undefined };
}
