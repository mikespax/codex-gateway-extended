import type { ThreadTokenUsageState, TokenUsageBreakdown } from "./types";
import { recordFromUnknown } from "./utils/records";

export function normalizeTokenUsage(value: unknown): ThreadTokenUsageState | null {
  const usage = recordFromUnknown(value);
  const total = normalizeTokenBreakdown(usage?.total);
  const last = normalizeTokenBreakdown(usage?.last);
  if (!total || !last) {
    return null;
  }
  return {
    total,
    last,
    modelContextWindow: numberOrNull(usage?.modelContextWindow),
  };
}

function normalizeTokenBreakdown(value: unknown): TokenUsageBreakdown | null {
  const usage = recordFromUnknown(value);
  const totalTokens = numberOrNull(usage?.totalTokens);
  const inputTokens = numberOrNull(usage?.inputTokens);
  const cachedInputTokens = numberOrNull(usage?.cachedInputTokens);
  const cacheWriteInputTokens = numberOrNull(usage?.cacheWriteInputTokens) ?? 0;
  const outputTokens = numberOrNull(usage?.outputTokens);
  const reasoningOutputTokens = numberOrNull(usage?.reasoningOutputTokens);
  if (
    totalTokens == null ||
    inputTokens == null ||
    cachedInputTokens == null ||
    outputTokens == null ||
    reasoningOutputTokens == null
  ) {
    return null;
  }
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

function numberOrNull(value: unknown) {
  if (value == null) {
    return null;
  }
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
