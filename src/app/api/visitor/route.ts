import { NextResponse } from "next/server";
import { chat, extractJson } from "@/lib/aai";
import { LEVEL_BY_ID } from "@/game/levels";
import { VOICE_LABEL, type LevelId, type VoiceId } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The visitor's next line, and the one judgement the model is trusted with.
 *
 * It has exactly two jobs: be the character, and answer one yes/no question —
 * does what the house just said clash with something it said earlier? It is
 * never asked how suspicious that is. The meter is scored in code, for reasons
 * docs/SPIKE-FINDINGS.md sets out at length.
 *
 * The two jobs are one call rather than two, because they are the same thought:
 * a visitor notices the thing that does not add up and *then* decides what to
 * ask next. Splitting them would cost a second round trip to learn less.
 *
 * This runs while the grown-up's line is still playing, so it has two or three
 * seconds of cover. Being right matters more than being quick.
 */

type Body = {
  level: LevelId;
  history: { speaker: string; text: string }[];
  /** what the adults of this house have claimed out loud, oldest first */
  claims?: { voice: string; text: string }[];
  /** open the connection and wake the model, throwing the answer away */
  warm?: boolean;
};

type Written = {
  line: string;
  addressed_to: string | null;
  contradicts?: boolean;
  contradiction?: string;
};

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
    ...(claims.length
      ? [
          ``,
          `This house has already told you:`,
          ...claims.map((c) => `- ${VOICE_LABEL[c.voice as VoiceId] ?? "someone"}: "${c.text}"`),
          ``,
          `Before you reply, check the last thing they said against that list. Set`,
          `"contradicts" to true only if the two cannot both be true — a different`,
          `person, a different place, a different time for the same thing. A`,
          `general claim counts when it rules out a specific one: "nobody here`,
          `drives" cannot stand beside "he took the car to the shop".`,
          `Vagueness is not a contradiction. Changing the subject is not a`,
          `contradiction. Not knowing something is not a contradiction. If it is`,
          `true, say what clashes in a few words, and let your line show you`,
          `noticed without spelling it out.`,
        ]
      : []),
    ``,
    `Answer as JSON and nothing else:`,
    `{"line": "<what you say>", "addressed_to": "dad" | "mom" | "uncle" | null,`,
    ` "contradicts": true | false, "contradiction": "<what clashes, or empty>"}`,
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
    const result = await chat({ messages, json: true, maxTokens: 200, temperature: 0.9 });
    const written = extractJson<Written>(result.content);
    const line = written?.line?.trim();

    if (!line) throw new Error("no line");

    const to = written?.addressed_to;
    const addressedTo: VoiceId | null =
      to === "dad" || to === "mom" || to === "uncle" ? to : null;

    // A contradiction claimed with nothing to contradict is the model being
    // agreeable, not observant.
    const found = Boolean(written?.contradicts) && claims.length > 0;
    const detail = written?.contradiction?.trim();

    return NextResponse.json({
      text: line,
      addressedTo,
      contradiction: { found, detail: found ? detail : undefined },
      latencyMs: result.latencyMs,
    });
  } catch {
    const text = PROD[Math.min(body.history.length >> 1, PROD.length - 1)];
    return NextResponse.json({ text, addressedTo: null, contradiction: null, fallback: true });
  }
}
