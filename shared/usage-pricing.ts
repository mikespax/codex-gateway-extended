import type { TokenUsageBreakdown } from "./types";

/**
 * Effective-dated pricing snapshot used for the local API-equivalent estimate.
 *
 * These are deliberately integer microdollars per million tokens. The snapshot is
 * versioned so a later price change never silently rewrites historical estimates.
 */
export const USAGE_PRICING_VERSION = "openai-api-2026-09-06";
export const LONG_CONTEXT_INPUT_THRESHOLD = 272_000;

const MICRODOLLARS_PER_DOLLAR = 1_000_000;
const TOKENS_PER_MILLION = 1_000_000n;

type PricingRate = {
  input: number;
  cachedInput: number;
  cacheWriteInput: number | null;
  output: number;
};

type ModelPricing = {
  standard: PricingRate;
  fast: PricingRate;
  longContextInputMultiplier?: number;
  longContextOutputMultiplier?: number;
};

function dollars(value: number) {
  return Math.round(value * MICRODOLLARS_PER_DOLLAR);
}

function rate(input: number, cachedInput: number, cacheWriteInput: number | null, output: number) {
  return {
    input: dollars(input),
    cachedInput: dollars(cachedInput),
    cacheWriteInput: cacheWriteInput === null ? null : dollars(cacheWriteInput),
    output: dollars(output),
  } satisfies PricingRate;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-6-astra": {
    standard: rate(10, 1, 12.5, 50),
    fast: rate(20, 2, 25, 100),
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5.6-sol": {
    standard: rate(4, 0.4, 5, 20),
    fast: rate(8, 0.8, 10, 30),
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5.6-terra": {
    standard: rate(2, 0.2, 2.5, 12),
    fast: rate(4, 0.4, 5, 18),
  },
  "gpt-5.6-luna": {
    standard: rate(0.2, 0.02, 0.25, 1.2),
    fast: rate(0.4, 0.04, 0.5, 1.8),
  },
  "gpt-5.3-codex": {
    standard: rate(1.75, 0.175, null, 14),
    fast: rate(3.5, 0.35, null, 28),
  },
};

const MODEL_ALIASES: Record<string, string> = {
  astra: "gpt-6-astra",
  "gpt-6-astra-latest": "gpt-6-astra",
  sol: "gpt-5.6-sol",
  "gpt-5.6-sol-latest": "gpt-5.6-sol",
  terra: "gpt-5.6-terra",
  "gpt-5.6-terra-latest": "gpt-5.6-terra",
  luna: "gpt-5.6-luna",
  "gpt-5.6-luna-latest": "gpt-5.6-luna",
  "gpt-5.3-codex-latest": "gpt-5.3-codex",
};

export type ApiEquivalentPricingResult = {
  costMicros: number | null;
  pricingVersion: string | null;
  completeness: "complete" | "partial" | "unknown";
};

export function estimateApiEquivalentCost(input: {
  model: string | null | undefined;
  serviceTier: string | null | undefined;
  usage: TokenUsageBreakdown;
}): ApiEquivalentPricingResult {
  const normalizedModel = normalizeModel(input.model);
  const modelPricing = normalizedModel === null ? null : MODEL_PRICING[normalizedModel];
  if (modelPricing === undefined || modelPricing === null) {
    return {
      costMicros: null,
      pricingVersion: null,
      completeness: "unknown",
    };
  }

  const pricing = isFastServiceTier(input.serviceTier) ? modelPricing.fast : modelPricing.standard;
  const longContext = input.usage.inputTokens > LONG_CONTEXT_INPUT_THRESHOLD;
  const inputMultiplier = longContext ? (modelPricing.longContextInputMultiplier ?? 1) : 1;
  const outputMultiplier = longContext ? (modelPricing.longContextOutputMultiplier ?? 1) : 1;
  const uncachedInputTokens = Math.max(
    0,
    input.usage.inputTokens - input.usage.cachedInputTokens - input.usage.cacheWriteInputTokens,
  );
  const uncachedInputCost = tokenCost(
    uncachedInputTokens,
    multiplyRate(pricing.input, inputMultiplier),
  );
  const cachedInputCost = tokenCost(
    input.usage.cachedInputTokens,
    multiplyRate(pricing.cachedInput, inputMultiplier),
  );
  const outputCost = tokenCost(
    input.usage.outputTokens,
    multiplyRate(pricing.output, outputMultiplier),
  );
  const knownCost = uncachedInputCost + cachedInputCost + outputCost;

  if (input.usage.cacheWriteInputTokens > 0 && pricing.cacheWriteInput === null) {
    return {
      costMicros: knownCost,
      pricingVersion: USAGE_PRICING_VERSION,
      completeness: "partial",
    };
  }

  return {
    costMicros:
      knownCost +
      tokenCost(
        input.usage.cacheWriteInputTokens,
        multiplyRate(pricing.cacheWriteInput ?? 0, inputMultiplier),
      ),
    pricingVersion: USAGE_PRICING_VERSION,
    completeness: "complete",
  };
}

export function normalizePricingModel(model: string | null | undefined) {
  return normalizeModel(model);
}

function normalizeModel(model: string | null | undefined) {
  if (typeof model !== "string") return null;
  const normalized = model.trim().toLowerCase();
  if (normalized === "") return null;
  return MODEL_ALIASES[normalized] ?? normalized;
}

function isFastServiceTier(serviceTier: string | null | undefined) {
  const normalized = typeof serviceTier === "string" ? serviceTier.trim().toLowerCase() : "";
  return normalized === "fast" || normalized === "priority";
}

function multiplyRate(rateMicros: number, multiplier: number) {
  return Math.round(rateMicros * multiplier);
}

function tokenCost(tokens: number, microsPerMillion: number) {
  if (tokens <= 0 || microsPerMillion <= 0) return 0;
  const tokenCount = BigInt(Math.max(0, Math.floor(tokens)));
  const rateMicros = BigInt(Math.max(0, Math.floor(microsPerMillion)));
  return Number((tokenCount * rateMicros + TOKENS_PER_MILLION / 2n) / TOKENS_PER_MILLION);
}
