import assert from "node:assert/strict";
import test from "node:test";
import {
  deepSeekPricingPeriod,
  nextPricingTransition,
} from "../../server/utils/gateway/provider-router/pricing";
import {
  requestContainsImage,
  turnInputContainsImage,
} from "../../server/utils/gateway/provider-router/image-detection";
import { classifyOpenAiFailure } from "../../server/utils/gateway/provider-router/quota";
import {
  assertPortableToolPairs,
  normalizePortableResponsesHistory,
} from "../../server/utils/gateway/provider-router/history";
import { routeProvider } from "../../server/utils/gateway/provider-router/matrix";

void test("DeepSeek pricing uses UTC weekday boundaries", () => {
  const monday = (hour: number, minute: number) =>
    new Date(
      `2026-09-07T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
    );
  assert.equal(deepSeekPricingPeriod(monday(0, 59)), "off_peak");
  assert.equal(deepSeekPricingPeriod(monday(1, 0)), "peak");
  assert.equal(deepSeekPricingPeriod(monday(3, 59)), "peak");
  assert.equal(deepSeekPricingPeriod(monday(4, 0)), "off_peak");
  assert.equal(deepSeekPricingPeriod(monday(5, 59)), "off_peak");
  assert.equal(deepSeekPricingPeriod(monday(6, 0)), "peak");
  assert.equal(deepSeekPricingPeriod(monday(9, 59)), "peak");
  assert.equal(deepSeekPricingPeriod(monday(10, 0)), "off_peak");
  assert.equal(deepSeekPricingPeriod(new Date("2026-09-06T02:00:00.000Z")), "off_peak");
  assert.ok(nextPricingTransition(monday(2, 0)).getTime() > monday(2, 0).getTime());
});

void test("image detection covers uploads, URLs, data and tool output", () => {
  assert.equal(
    requestContainsImage({ type: "input_image", image_url: "https://x.test/a.png" }),
    true,
  );
  assert.equal(requestContainsImage({ output: { data: "data:image/png;base64,abc" } }), true);
  assert.equal(requestContainsImage({ file: { id: "file_123", mime_type: "image/jpeg" } }), true);
  assert.equal(requestContainsImage({ type: "function_call_output", output: "text only" }), false);
  assert.equal(
    turnInputContainsImage({
      text: "",
      files: [{ path: "shot.webp", name: "shot.webp", size: 1, isImage: false }],
    }),
    true,
  );
});

void test("only true allowance exhaustion poisons OpenAI quota state", () => {
  assert.equal(classifyOpenAiFailure({ status: 429, message: "rate limit" }).kind, "rate_limit");
  assert.equal(
    classifyOpenAiFailure({ status: 401, message: "unauthorized" }).kind,
    "authentication",
  );
  assert.equal(classifyOpenAiFailure({ status: 500, message: "upstream" }).kind, "temporary");
  assert.equal(
    classifyOpenAiFailure({ code: "insufficient_quota", message: "quota exceeded" }).kind,
    "quota_exhausted",
  );
  assert.equal(
    classifyOpenAiFailure({
      code: "insufficient_quota",
      message: "subscription allowance exhausted",
      quotaResetAt: "2026-09-07T00:00:00Z",
    }).resetAt,
    "2026-09-07T00:00:00.000Z",
  );
  assert.equal(
    classifyOpenAiFailure({
      rpcData: { code: "insufficient_quota", message: "subscription allowance exhausted" },
    }).kind,
    "quota_exhausted",
  );
});

void test("portable history removes opaque reasoning and rejects broken tool pairs", () => {
  const normalized = normalizePortableResponsesHistory([
    { type: "reasoning", encrypted_content: "secret" },
    { type: "function_call", call_id: "call_1" },
    { type: "function_call_output", call_id: "call_1", output: "ok" },
  ]);
  assert.equal(normalized.omittedOpaqueReasoning, 1);
  assert.equal(normalized.brokenToolPairs, 0);
  assert.throws(() => assertPortableToolPairs([{ type: "function_call", call_id: "call_2" }]));
});

void test("provider matrix enforces all three modes and quota fallback", () => {
  const base = {
    useOpenRouterCreditsFirst: true,
    openrouter: "available" as const,
    period: "off_peak" as const,
    containsImages: false,
    requestedOpenAiModel: "gpt-5.6-luna",
    openRouterTextModel: "deepseek/deepseek-v4-pro",
    openRouterVisionModel: "deepseek/deepseek-v4-flash-vision-exp",
    directTextModel: "deepseek-v4-pro",
    directVisionModel: "deepseek-v4-flash-vision-exp",
  };
  assert.equal(
    routeProvider({ ...base, mode: "openai", openaiQuota: "available" }).transport,
    "openai",
  );
  assert.equal(
    routeProvider({ ...base, mode: "openai", openaiQuota: "exhausted" }).transport,
    "openai",
  );
  assert.equal(
    routeProvider({ ...base, mode: "hybrid", openaiQuota: "available" }).effectiveProvider,
    "deepseek",
  );
  assert.equal(
    routeProvider({ ...base, mode: "hybrid", period: "peak", openaiQuota: "available" })
      .effectiveProvider,
    "openai",
  );
  assert.equal(
    routeProvider({ ...base, mode: "hybrid", period: "peak", openaiQuota: "exhausted" })
      .effectiveProvider,
    "deepseek",
  );
  assert.equal(
    routeProvider({ ...base, mode: "deepseek", openaiQuota: "available" }).effectiveProvider,
    "deepseek",
  );
  assert.equal(
    routeProvider({ ...base, mode: "deepseek", openaiQuota: "available", containsImages: true })
      .model,
    "deepseek/deepseek-v4-flash-vision-exp",
  );
  assert.equal(
    routeProvider({ ...base, mode: "deepseek", openaiQuota: "available", openrouter: "exhausted" })
      .transport,
    "deepseek",
  );
  assert.equal(
    routeProvider({
      ...base,
      mode: "deepseek",
      openaiQuota: "available",
      openrouter: "unavailable",
    }).transport,
    "deepseek",
  );
});
