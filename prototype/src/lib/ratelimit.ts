// Simple in-memory sliding-window rate limit for the review endpoint (demo protection for the API key).
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit = 12, windowMs = 10 * 60_000): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return { ok: false, retryAfter: Math.ceil((windowMs - (now - list[0])) / 1000) };
  list.push(now);
  hits.set(key, list);
  return { ok: true, retryAfter: 0 };
}
