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
  return Number(process.env.MAX_RUNS_PER_BROWSER_PER_HOUR ?? 5);
}

function maxRunSeconds(): number {
  return Number(process.env.MAX_RUN_SECONDS ?? 420);
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

/**
 * Nights in progress, and how many times each has asked for fresh tokens.
 *
 * A night is four doors and each door opens its own transcript session, so one
 * night needs several tokens. Charging a run for each of them would make the
 * hourly cap mean a third of what it says. The first call starts a night and
 * spends a run; the rest of that night's doors refill against the same id for
 * free, up to a bound that no honest night comes near.
 */
const nights = new Map<string, { refills: number; startedAt: number }>();
const REFILLS_PER_NIGHT = 10;

function resume(run: string): boolean {
  const night = nights.get(run);
  if (!night) return false;
  if (Date.now() - night.startedAt > WINDOW_MS) {
    nights.delete(run);
    return false;
  }
  if (night.refills >= REFILLS_PER_NIGHT) return false;
  night.refills += 1;
  return true;
}

function sweep() {
  const now = Date.now();
  for (const [id, night] of nights) {
    if (now - night.startedAt > WINDOW_MS) nights.delete(id);
  }
}

export async function POST(req: Request) {
  const id = browserId(req);
  const limit = maxRunsPerHour();

  sweep();
  const body = (await req.json().catch(() => ({}))) as { run?: string };
  const resumed = typeof body.run === "string" && resume(body.run);
  const run = resumed ? body.run! : crypto.randomUUID();

  let remaining = limit - since(`browser:${id}`).length;
  if (!resumed) {
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
    remaining = budget.remaining;
    nights.set(run, { refills: 0, startedAt: Date.now() });
  }

  try {
    // Each door's session is capped, and a door is the unit that can be
    // abandoned: close the tab mid-encounter and the socket bills on until this
    // cap, not until the end of a whole night. Streaming bills on how long the
    // socket is open, idle or not, which the API docs call the commonest cause
    // of a surprise invoice.
    const cap = maxRunSeconds();
    const [stt, tts] = await Promise.all([
      // Minted while the player is still writing excuses and not used until
      // they are done, so a token has to outlive the prep phase.
      mintSttToken(300, Math.max(60, cap)),
      mintTtsToken(300, Math.max(60, cap)),
    ]);

    const res = NextResponse.json({
      run,
      stt,
      tts,
      runSeconds: cap,
      runsLeftThisHour: Math.max(0, remaining),
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
