import type { ProviderDecision } from "./types";

export function logProviderDecision(
  requestId: string,
  threadId: string,
  decision: ProviderDecision,
  details: { status?: string; durationMs?: number; fallbackReason?: string | null } = {},
) {
  console.info("[provider-router] request", {
    requestId,
    threadId,
    mode: decision.mode,
    logicalProvider: decision.logicalProvider,
    effectiveProvider: decision.effectiveProvider,
    transport: decision.transport,
    model: decision.model,
    containsImages: decision.containsImages,
    deepseekPricePeriod: decision.deepseekPeriod,
    reason: decision.reason,
    ...details,
  });
}
