import { NextResponse } from "next/server";
import { mintSttToken, mintTtsToken } from "@/lib/aai";
import { caller, recent, take, HOUR_MS } from "@/lib/guard";

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
  if (Date.now() - night.startedAt > HOUR_MS) {
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
    if (now - night.startedAt > HOUR_MS) nights.delete(id);
  }
}

export async function POST(req: Request) {
  const id = browserId(req);
  const limit = maxRunsPerHour();

  sweep();
  const body = (await req.json().catch(() => ({}))) as { run?: string };
  const resumed = typeof body.run === "string" && resume(body.run);
  const run = resumed ? body.run! : crypto.randomUUID();

  let remaining = limit - recent(`browser:${id}`).length;
  if (!resumed) {
    const budget = take([
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

    // Both tokens have to outlive the door they are minted for, and the TTS
    // one is the reason why: it authorises every line the house speaks, over
    // HTTP, for as long as the door is open. At five minutes it expired before
    // a door capped at seven could end — so a slow encounter would simply lose
    // its voice part way through, and every line after that would fail.
    //
    // Ten minutes is the documented maximum and comfortably outlasts the cap,
    // which is what makes this a class of bug rather than a number to tune.
    // The session cap, not the token's life, is what bounds a door.
    const usableFor = 600;
    const [stt, tts] = await Promise.all([
      mintSttToken(usableFor, Math.max(60, cap)),
      mintTtsToken(usableFor, Math.max(60, cap)),
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
