export interface RateLimiter { check(key: string, limit: number, windowMs: number): boolean }
export class MemoryRateLimitProvider implements RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  check(key: string, limit: number, windowMs: number) {
    const now = Date.now(); const hit = this.hits.get(key);
    if (!hit || hit.reset < now) { this.hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    hit.count += 1; return hit.count <= limit;
  }
}
// Production deployments can replace this provider with a Redis/Upstash implementation.
export const rateLimiter: RateLimiter = new MemoryRateLimitProvider();
