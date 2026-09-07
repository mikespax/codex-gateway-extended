import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { runWithGatewayUser } from "../../server/utils/gateway/state/memory";
import { TurnUsageRepository } from "../../server/utils/gateway/usage/turn-usage-repository";

void test("usage ledger deduplicates a raw response and persists the turn projection", async () => {
  const directory = await mkdtemp(`${tmpdir()}/codex-gateway-usage-`);
  process.env.CODEX_GATEWAY_DB_PATH = `${directory}/usage.db`;
  process.env.CODEX_GATEWAY_CONFIG_SECRET = "unit-test-usage-secret";
  const repository = new TurnUsageRepository();

  await runWithGatewayUser(42, async () => {
    const input = {
      hostId: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      responseId: "response-1",
      source: "raw_response" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      serviceTier: "standard",
      usage: {
        totalTokens: 120,
        inputTokens: 100,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 0,
      },
      apiEquivalentCostMicros: 480,
      pricingVersion: "test",
      pricingCompleteness: "complete" as const,
      observedAt: 100,
    };
    repository.recordRequest(42, input);
    repository.recordRequest(42, input);
    repository.recordRequest(42, { ...input, hostId: 2 });
    const aggregate = repository.aggregateTurn(42, "thread-1", "turn-1");
    assert.equal(aggregate?.requestCount, 1);
    assert.equal(aggregate?.usage.totalTokens, 120);

    repository.saveTurn(42, {
      hostId: 1,
      threadId: "thread-1",
      turnId: "turn-unpriced",
      usageScope: "direct_turn",
      usageSource: "unavailable",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      apiEquivalentCostMicros: null,
      pricingVersion: null,
      pricingCompleteness: "unknown",
      providerEstimatedCreditsMicros: null,
      providerEstimatedUsdMicros: null,
      quotaBefore: null,
      quotaAfter: null,
      quotaDeltas: [],
      quotaAttributionConfidence: "unavailable",
      terminalStatus: "completed",
      protocolVersion: "0.152.1",
      protocolSchemaHash: "schema",
      observedAt: 100,
    });
    assert.equal(repository.listThread(42, "thread-1")[0]?.apiEquivalentCostMicros, null);
    assert.equal(repository.monthSummary(42, 200).apiEquivalentCostMicros, null);

    repository.saveTurn(42, {
      hostId: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      usageScope: "direct_turn",
      usageSource: "raw_responses",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      serviceTier: "standard",
      totalTokens: 120,
      inputTokens: 100,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      apiEquivalentCostMicros: 480,
      pricingVersion: "test",
      pricingCompleteness: "complete",
      providerEstimatedCreditsMicros: null,
      providerEstimatedUsdMicros: null,
      quotaBefore: null,
      quotaAfter: null,
      quotaDeltas: [],
      quotaAttributionConfidence: "unavailable",
      terminalStatus: "completed",
      protocolVersion: "0.152.1",
      protocolSchemaHash: "schema",
      observedAt: 100,
    });
    const rows = repository.listThread(42, "thread-1");
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.apiEquivalentCostMicros, 480);
  });

  await rm(directory, { recursive: true, force: true });
});
