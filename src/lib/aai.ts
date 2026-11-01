/**
 * Server-side AssemblyAI. The API key lives here and nowhere else.
 *
 * The browser never sees it: it gets short-lived tokens from /api/token and
 * talks to the STT and TTS hosts directly, which keeps two hops off the
 * critical path between releasing the key and hearing the adult voice.
 *
 * Field names and routes are the ones verified in docs/API-NOTES.md.
 */

const STT_TOKEN_URL = "https://streaming.assemblyai.com/v3/token";
const TTS_TOKEN_URL = "https://token.us.assemblyai.com/v1/token";
const LLM_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions";

export function apiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY is not set");
  return key;
}

/** Keep one agent-ish connection warm by reusing fetch; Node pools for us. */
async function get(url: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: apiKey() }, cache: "no-store" });
}

/**
 * STT token. Note the route and shape differ from the TTS one — different
 * host, no `product` parameter. Not single-use: mint one per connection.
 */
export async function mintSttToken(expiresInSeconds = 60, maxSessionSeconds = 240) {
  const url = new URL(STT_TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(expiresInSeconds));
  url.searchParams.set("max_session_duration_seconds", String(maxSessionSeconds));

  const res = await get(url.toString());
  if (!res.ok) throw new Error(`STT token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

/** TTS token. Different host and shape from STT — `product=tts` is required. */
export async function mintTtsToken(expiresInSeconds = 60, maxSessionSeconds = 240) {
  const url = new URL(TTS_TOKEN_URL);
  url.searchParams.set("product", "tts");
  url.searchParams.set("expires_in_seconds", String(expiresInSeconds));
  url.searchParams.set("max_session_duration_seconds", String(maxSessionSeconds));

  const res = await get(url.toString());
  if (!res.ok) throw new Error(`TTS token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string; expires_in_seconds: number };
  return data.token;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Picked on how well it tells four kinds of bad answer apart, not on speed.
 * Scored against answers written to trip one flag each (scripts/probe.mjs):
 * gemini 6/8, nemotron-nano 4/8, gemma 2/8, haiku-5-5 unparsable. The two
 * faster models are only ~500 ms quicker and get the meter wrong, and the
 * brain runs while the grown-up line is still playing, so it has the room.
 */
export const BRAIN_MODEL = "gemini-2.5-flash-lite";

export type ChatResult = {
  content: string;
  requestId: string;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  latencyMs: number;
};

/** One LLM Gateway completion. The visitor's brain runs on this. */
export async function chat(opts: {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** ask for a JSON object back; gemma-4-31b honours this, qwen refuses it */
  json?: boolean;
}): Promise<ChatResult> {
  const started = Date.now();
  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: { Authorization: apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? BRAIN_MODEL,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 400,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM Gateway failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    request_id: string;
    choices: { message: { content: string }; finish_reason: string }[];
    usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    requestId: data.request_id,
    usage: data.usage,
    latencyMs: Date.now() - started,
  };
}

/**
 * Pull the first JSON object out of a model reply. Models wrap JSON in prose
 * or a fenced block often enough that asking nicely is not a strategy.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  // Walk to the matching brace so trailing prose doesn't break the parse.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
