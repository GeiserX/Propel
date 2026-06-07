// In-memory sliding-window rate limiter.
//
// IMPORTANT: This is valid ONLY for a single Node instance (Pumperly is
// single-instance, no Redis). The module-level Map is a genuine shared
// singleton across requests in the Next.js Node server runtime.
//
// Call this from Route Handlers ONLY — NOT from middleware.ts / proxy.ts.
// Next.js 16 explicitly warns against relying on shared modules/globals in
// proxy (it may run in a separate runtime/CDN), so the limiter lives in the
// app server process where Route Handlers run.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window limiter: allow `limit` requests per `windowMs` per `key`.
 * Returns whether the request is allowed plus remaining budget and reset time.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, resetAt: b.resetAt };
}

/**
 * Extract the client IP from proxy headers, taking the FIRST value of
 * X-Forwarded-For, then falling back to X-Real-IP, then "unknown".
 *
 * SECURITY: This assumes a TRUSTED reverse proxy (Caddy) that REPLACES the
 * X-Forwarded-For header on each request — it must not blindly append to a
 * client-supplied value. Behind such a proxy the first XFF entry is the real
 * client IP and the per-IP rate-limit key is reliable. If Pumperly is exposed
 * DIRECTLY (no proxy, or a proxy that appends rather than replaces XFF), a
 * client can spoof X-Forwarded-For / X-Real-IP and forge an arbitrary key,
 * defeating the per-IP limiter. Self-hosters MUST front this app with Caddy
 * (or an equivalent proxy that sanitizes these headers).
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// Periodic cleanup so the Map can't grow unbounded. setInterval is fine in the
// Node server process (NOT in proxy). unref() so it never blocks shutdown.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
}, 60_000);
cleanup.unref?.();
