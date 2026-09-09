import type { CodexRateLimitSummary } from "~~/shared/types";

export const CODEX_RATE_LIMIT_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 256;

interface CachedRateLimits {
  expiresAt: number;
  value: CodexRateLimitSummary;
}

export type RateLimitReadCacheState = "built" | "shared" | "cached";

export interface RateLimitReadResult {
  value: CodexRateLimitSummary;
  cacheState: RateLimitReadCacheState;
}

/**
 * Keep the usage badge from turning multiple browser mounts into parallel app-server RPCs.
 * Failures are deliberately not cached, so a transient outage can recover on the next read.
 */
export class CodexRateLimitReadCache {
  private readonly cache = new Map<string, CachedRateLimits>();
  private readonly pending = new Map<string, Promise<CodexRateLimitSummary>>();

  constructor(
    private readonly ttlMs = CODEX_RATE_LIMIT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async read(
    key: string,
    loader: () => Promise<CodexRateLimitSummary>,
  ): Promise<RateLimitReadResult> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      if (cached.expiresAt > this.now()) {
        return { value: cached.value, cacheState: "cached" };
      }
      this.cache.delete(key);
    }

    const existing = this.pending.get(key);
    if (existing !== undefined) {
      return { value: await existing, cacheState: "shared" };
    }

    const request = loader().then((value) => {
      this.cache.set(key, { value, expiresAt: this.now() + this.ttlMs });
      this.trimCache();
      return value;
    });
    this.pending.set(key, request);
    try {
      return { value: await request, cacheState: "built" };
    } finally {
      if (this.pending.get(key) === request) {
        this.pending.delete(key);
      }
    }
  }

  private trimCache() {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }
}
