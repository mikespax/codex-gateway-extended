/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
import assert from "node:assert/strict";
import test from "node:test";
import type { CodexRateLimitWindow } from "../../shared/types/account-usage";
import { codexRateLimitSummaryFromResponse } from "../../server/utils/gateway/protocol/account-rate-limits";
import { estimateApiEquivalentCost } from "../../shared/usage-pricing";

void test("API-equivalent pricing separates cached, cache-write, and output tokens", () => {
  const result = estimateApiEquivalentCost({
    model: "gpt-5.6-sol",
    serviceTier: "standard",
    usage: {
      totalTokens: 110_000,
      inputTokens: 100_000,
      cachedInputTokens: 10_000,
      cacheWriteInputTokens: 5_000,
      outputTokens: 10_000,
      reasoningOutputTokens: 0,
    },
  });
  assert.equal(result.costMicros, 569_000);
  assert.equal(result.completeness, "complete");
});

void test("fast and long-context pricing use the versioned pricing rules", () => {
  const fast = estimateApiEquivalentCost({
    model: "sol",
    serviceTier: "fast",
    usage: {
      totalTokens: 300_000,
      inputTokens: 280_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 20_000,
      reasoningOutputTokens: 0,
    },
  });
  assert.equal(fast.costMicros, 5_380_000);
  assert.equal(fast.completeness, "complete");

  const unknown = estimateApiEquivalentCost({
    model: "unlisted-model",
    serviceTier: "standard",
    usage: {
      totalTokens: 1,
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
  });
  assert.equal(unknown.costMicros, null);
  assert.equal(unknown.completeness, "unknown");
});

void test("rate-limit accounting keys windows by duration rather than role", () => {
  const summary = codexRateLimitSummaryFromResponse(7, {
    rateLimits: null,
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        limitName: "Codex",
        planType: "pro",
        primary: { usedPercent: 41.25, windowDurationMins: 10_080, resetsAt: 123 },
        secondary: { usedPercent: 12.5, windowDurationMins: 300, resetsAt: 456 },
      },
    },
  });
  assert.deepEqual(
    summary.windows.map((window: CodexRateLimitWindow & { key: string }) => [
      window.key,
      window.usedPercent,
    ]),
    [
      ["codex:10080m", 41.25],
      ["codex:300m", 12.5],
    ],
  );
});
