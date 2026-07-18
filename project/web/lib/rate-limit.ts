/**
 * Lightweight in-memory rate limiter.
 *
 * This is sufficient for a single-instance deployment or local development.
 * For multi-instance production deployments, replace the `store` Map with
 * Upstash Redis (https://upstash.com) or another shared store — the public
 * `rateLimit()` function signature is designed to be a drop-in swap.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// Periodically sweep expired buckets so memory doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt < now) store.delete(key);
  }
}, 60_000).unref?.();

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt < now) {
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    store.set(key, bucket);
    return { success: true, limit, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  if (existing.count >= limit) {
    return { success: false, limit, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    success: true,
    limit,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  };
}
