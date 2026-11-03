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
  return Number(process.env.MAX_RUNS_PER_BROWSER_PER_HOUR ?? 3);
}

function maxRunSeconds(): number {
  return Number(process.env.MAX_RUN_SECONDS ?? 1200);
}

function browserId(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)cs_bid=([^;]+)/);
  if (match) return match[1];
  return crypto.randomUUID();
}

/** The caller's address, as the platform reports it. */
function caller(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function since(key: string): number[] {
  const now = Date.now();
  return (runs.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

/**
 * Spend one run against every bucket at once, and only if all of them have
 * room.
 *
 * Counting the cookie alone was not a guard at all: no cookie meant a fresh
 * identity, so anything that simply declined to keep cookies had no limit.
 * The address is the bucket that cannot be thrown away.
 *
 * Its allowance is deliberately several times the per-browser one, because the
 * one place this link is most likely to be opened by several people at once —
 * a room full of people on the same wifi — is exactly the place where locking
 * them out would be worst.
 */
function spend(buckets: { key: string; limit: number }[]): { ok: boolean; remaining: number } {
  const lists = buckets.map((b) => ({ ...b, list: since(b.key) }));

  if (lists.some((b) => b.list.length >= b.limit)) {
    for (const b of lists) runs.set(b.key, b.list);
    return { ok: false, remaining: 0 };
  }

  const now = Date.now();
  let remaining = Number.POSITIVE_INFINITY;
  for (const b of lists) {
    b.list.push(now);
    runs.set(b.key, b.list);
    remaining = Math.min(remaining, b.limit - b.list.length);
  }
  return { ok: true, remaining };
}

export async function POST(req: Request) {
  const id = browserId(req);
  const limit = maxRunsPerHour();
  const budget = spend([
    { key: `browser:${id}`, limit },
    { key: `caller:${caller(req)}`, limit: limit * 5 },
  ]);

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
      // Minted while the player is still writing excuses and not used until
      // they are done, so a token has to outlive the prep phase. The session
      // cap is what actually bounds a run.
      mintSttToken(300, Math.max(60, cap)),
      mintTtsToken(300, Math.max(60, cap)),
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
