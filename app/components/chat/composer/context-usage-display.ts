import type { ThreadTokenUsageState } from "~~/shared/types";

export interface ContextUsageDisplay {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function projectContextUsage(
  tokenUsage: ThreadTokenUsageState | null,
): ContextUsageDisplay | null {
  const latest = tokenUsage?.last;
  const maxTokens = tokenUsage?.modelContextWindow;
  if (latest === undefined || maxTokens === null || maxTokens === undefined || maxTokens <= 0) {
    return null;
  }

  return {
    usedTokens: latest.totalTokens,
    maxTokens,
    percent: Math.min(100, Math.max(0, Math.ceil((latest.totalTokens / maxTokens) * 100))),
    inputTokens: latest.inputTokens,
    outputTokens: latest.outputTokens,
    reasoningTokens: latest.reasoningOutputTokens,
    cacheReadTokens: latest.cachedInputTokens,
    cacheWriteTokens: latest.cacheWriteInputTokens,
  };
}
