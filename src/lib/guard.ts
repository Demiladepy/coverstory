/**
 * The sliding window both API routes count against.
 *
 * In memory, so it resets on redeploy and does not span instances. That is
 * the right size of guard for a demo link on somebody's own key: it stops the
 * link being farmed, it does not pretend to be a quota system. If it ever has
 * to be real it moves to a KV store, not to a bigger map.
 */

export const HOUR_MS = 60 * 60 * 1000;

const windows = new Map<string, number[]>();

/** What is left in this key's window, without spending anything. */
export function recent(key: string, windowMs = HOUR_MS): number[] {
  const now = Date.now();
  return (windows.get(key) ?? []).filter((t) => now - t < windowMs);
}

export type Bucket = { key: string; limit: number };

/**
 * Spend one against every bucket at once, and only if all of them have room.
 *
 * Several buckets because one is never enough: a cookie identifies a browser
 * and can simply be dropped, so the caller's address has to be counted too.
 */
export function take(
  buckets: Bucket[],
  windowMs = HOUR_MS,
): { ok: boolean; remaining: number } {
  const lists = buckets.map((b) => ({ ...b, list: recent(b.key, windowMs) }));

  if (lists.some((b) => b.list.length >= b.limit)) {
    for (const b of lists) windows.set(b.key, b.list);
    return { ok: false, remaining: 0 };
  }

  const now = Date.now();
  let remaining = Number.POSITIVE_INFINITY;
  for (const b of lists) {
    b.list.push(now);
    windows.set(b.key, b.list);
    remaining = Math.min(remaining, b.limit - b.list.length);
  }
  return { ok: true, remaining };
}

/** The caller's address, as the platform reports it. */
export function caller(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

/**
 * Cut a line of dialogue down to something a prompt can afford.
 *
 * Truncating rather than refusing, because the only way a real player reaches
 * this is by talking for a very long time, and losing the tail of a rambling
 * sentence is a far better outcome than losing the turn.
 */
export const MAX_LINE = 600;

export function trim(text: unknown): string {
  return typeof text === "string" ? text.slice(0, MAX_LINE) : "";
}
