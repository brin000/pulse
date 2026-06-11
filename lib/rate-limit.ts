/**
 * Minimal in-memory sliding-window rate limiter for /api/agent.
 *
 * Deliberately not distributed: state lives per server instance, so on a
 * multi-instance deployment the effective limit is N × maxRuns. That is
 * acceptable for the MVP — the goal is stopping casual abuse of the shared
 * LLM key, not precise quota accounting.
 */

const WINDOW_MS = 10 * 60_000;
const MAX_RUNS_PER_WINDOW = 10;
/** Prevents unbounded growth if many distinct IPs hit the endpoint. */
const MAX_TRACKED_KEYS = 10_000;

const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest hit leaves the window (only set when blocked). */
  retryAfterSec?: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= MAX_RUNS_PER_WINDOW) {
    hits.set(key, recent);
    return {
      allowed: false,
      retryAfterSec: Math.ceil((recent[0] + WINDOW_MS - now) / 1000),
    };
  }

  recent.push(now);
  // Crude eviction: drop everything when the map gets large. Losing rate
  // state momentarily is harmless; leaking memory forever is not.
  if (!hits.has(key) && hits.size >= MAX_TRACKED_KEYS) hits.clear();
  hits.set(key, recent);
  return { allowed: true };
}
