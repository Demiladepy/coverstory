import { NextResponse } from "next/server";
import { chat, extractJson } from "@/lib/aai";
import { LEVEL_BY_ID } from "@/game/levels";
import { VOICE_LABEL, type LevelId, type VoiceId } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Writes the visitor's next line.
 *
 * The model's whole job here is the character and the pressure — it decides
 * what to ask and who to ask, and nothing else. It is deliberately not asked to
 * judge the answer or move the meter; that is scored in code, for reasons the
 * spike findings set out at length.
 *
 * This runs while the grown-up's line is still playing, so it has two or three
 * seconds of cover. Accuracy of character beats speed here.
 */

type Body = {
  level: LevelId;
  history: { speaker: string; text: string }[];
  /** open the connection and wake the model, throwing the answer away */
  warm?: boolean;
};

type Written = { line: string; addressed_to: string | null };

/** If the model falls over, the visitor still has to say something. */
const PROD = [
  "Sorry — say that again?",
  "I didn't catch that. Who am I speaking to?",
  "Right. And you are?",
];

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // The first completion of a run costs about three seconds and every one
  // after it costs one. That first one would land on the player's first answer,
  // which is the worst place for it, so it is spent here instead — during the
  // visitor's opening line, where there is four seconds of audio to hide in.
  if (body.warm) {
    await chat({ messages: [{ role: "user", content: "ok" }], maxTokens: 1 }).catch(() => {});
    return NextResponse.json({ warmed: true });
  }

  const level = LEVEL_BY_ID[body.level];
  if (!level) return NextResponse.json({ error: "unknown_level" }, { status: 400 });

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
    `- Never accuse anyone of being a child, and never say the word "child". If`,
    `  something feels off, ask an ordinary question about it instead.`,
    `- The adults in this house are ${Object.values(VOICE_LABEL).join(", ")}. Only`,
    `  address one by name once you have reason to think they are there.`,
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
        : {
            role: "user" as const,
            content: `[${VOICE_LABEL[turn.speaker as VoiceId] ?? "someone"}] ${turn.text}`,
          },
    ),
  ];

  try {
    const result = await chat({ messages, json: true, maxTokens: 160, temperature: 0.9 });
    const written = extractJson<Written>(result.content);
    const line = written?.line?.trim();

    if (!line) throw new Error("no line");

    const to = written?.addressed_to;
    const addressedTo: VoiceId | null =
      to === "dad" || to === "mom" || to === "uncle" ? to : null;

    return NextResponse.json({ text: line, addressedTo, latencyMs: result.latencyMs });
  } catch {
    const text = PROD[Math.min(body.history.length >> 1, PROD.length - 1)];
    return NextResponse.json({ text, addressedTo: null, fallback: true });
  }
}
