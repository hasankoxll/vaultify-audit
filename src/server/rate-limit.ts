export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
