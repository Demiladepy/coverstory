import { NextResponse } from "next/server";
import { mintSttToken, mintTtsToken } from "@/lib/aai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands the browser one STT token and one TTS token for a single run, and
 * counts runs per browser so a public link can't be farmed.
 *
 * The counter is in memory, which means it resets on redeploy and doesn't span
 * instances. That is the right size of guard for a hackathon link; if the run
 * cap ever has to be real, it moves to a KV store, not to a bigger map.
 */

const WINDOW_MS = 60 * 60 * 1000;
const runs = new Map<string, number[]>();

function maxRunsPerHour(): number {
  return Number(process.env.MAX_RUNS_PER_BROWSER_PER_HOUR ?? 6);
}

function maxRunSeconds(): number {
  return Number(process.env.MAX_RUN_SECONDS ?? 200);
}

function browserId(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)cs_bid=([^;]+)/);
  if (match) return match[1];
  return crypto.randomUUID();
}

function spend(id: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const recent = (runs.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  const limit = maxRunsPerHour();

  if (recent.length >= limit) {
    runs.set(id, recent);
    return { ok: false, remaining: 0 };
  }

  recent.push(now);
  runs.set(id, recent);
  return { ok: true, remaining: limit - recent.length };
}

export async function POST(req: Request) {
  const id = browserId(req);
  const budget = spend(id);

  if (!budget.ok) {
    return NextResponse.json(
      { error: "budget", message: "That's enough runs for one hour. Come back later." },
      { status: 429 },
    );
  }

  try {
    // The run is capped at both ends: the token's own session cap, and a
    // client-side timer. A session that outlives the cap keeps billing.
    const cap = maxRunSeconds();
    const [stt, tts] = await Promise.all([
      mintSttToken(60, Math.max(60, cap)),
      mintTtsToken(60, Math.max(60, cap)),
    ]);

    const res = NextResponse.json({
      stt,
      tts,
      runSeconds: cap,
      runsLeftThisHour: budget.remaining,
    });
    res.cookies.set("cs_bid", id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "mint_failed", message }, { status: 502 });
  }
}
