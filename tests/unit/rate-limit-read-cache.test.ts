import assert from "node:assert/strict";
import test from "node:test";
import type { CodexRateLimitSummary } from "../../shared/types";
import {
  CodexRateLimitReadCache,
  CODEX_RATE_LIMIT_CACHE_TTL_MS,
} from "../../server/utils/gateway/runtime/rate-limit-read-cache";

const summary: CodexRateLimitSummary = {
  hostId: 2,
  limitId: "codex",
  limitName: "Codex",
  planType: "team",
  primary: null,
  secondary: null,
  windows: [],
  observedAt: 1,
};

void test("rate-limit reads coalesce concurrent loads and serve a short cache", async () => {
  let now = 1_000;
  let calls = 0;
  let release: (() => void) | undefined;
  const cache = new CodexRateLimitReadCache(CODEX_RATE_LIMIT_CACHE_TTL_MS, () => now);
  const loader = async () => {
    calls += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return summary;
  };

  const first = cache.read("user:host", loader);
  const second = cache.read("user:host", loader);
  assert.equal(calls, 1);
  release?.();
  assert.equal((await first).cacheState, "built");
  assert.equal((await second).cacheState, "shared");

  assert.equal((await cache.read("user:host", loader)).cacheState, "cached");
  assert.equal(calls, 1);

  now += CODEX_RATE_LIMIT_CACHE_TTL_MS + 1;
  const refreshed = await cache.read("user:host", async () => {
    calls += 1;
    return { ...summary, observedAt: now };
  });
  assert.equal(refreshed.cacheState, "built");
  assert.equal(calls, 2);
});

void test("failed rate-limit reads are not cached and can retry", async () => {
  let calls = 0;
  const cache = new CodexRateLimitReadCache();
  await assert.rejects(
    cache.read("user:host", async () => {
      calls += 1;
      throw new Error("temporary RPC failure");
    }),
    /temporary RPC failure/,
  );
  await assert.rejects(
    cache.read("user:host", async () => {
      calls += 1;
      throw new Error("temporary RPC failure");
    }),
    /temporary RPC failure/,
  );
  assert.equal(calls, 2);
});
