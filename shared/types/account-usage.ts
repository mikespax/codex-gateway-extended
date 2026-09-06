export interface CodexRateLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitObservation {
  hostId: number;
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  /** Dynamic windows retained for accounting; primary/secondary are compatibility projections. */
  windows: Array<CodexRateLimitWindow & { key: string }>;
  observedAt: number;
}

export interface UsageMonthSummary {
  periodStart: string;
  apiEquivalentCostMicros: number;
  subscriptionPriceMicros: number | null;
  subscriptionPriceSource: "configured" | "unavailable";
  paybackRatio: number | null;
}

export interface UsagePeriodSummary {
  periodStart: string;
  periodEnd: string;
  turnCount: number;
  pricedTurnCount: number;
  totalTokens: number;
  apiEquivalentCostMicros: number;
}

export interface UsageQuotaSnapshot {
  hostId: number;
  hostName: string | null;
  key: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  observedAt: number;
  source: "live" | "persisted";
}

export interface UsageDashboardSummary {
  generatedAt: number;
  thisMonth: UsageMonthSummary;
  monthly: UsagePeriodSummary[];
  weekly: UsagePeriodSummary[];
  quotaWindows: UsageQuotaSnapshot[];
  liveHostCount: number;
  failedHostCount: number;
}

export type CodexRateLimitSummary = CodexRateLimitObservation & {
  thisMonth?: UsageMonthSummary;
};

export type UsageScope = "direct_turn" | "inclusive_descendants";
export type UsageSource =
  | "raw_responses"
  | "cumulative_delta"
  | "provider_thread_delta"
  | "unavailable";
export type PricingCompleteness = "complete" | "partial" | "unknown";
export type QuotaAttributionConfidence =
  | "account_observation"
  | "reset_between_snapshots"
  | "unavailable";

export interface CodexQuotaWindowDelta {
  key: string;
  windowDurationMins: number | null;
  beforeUsedPercent: number | null;
  afterUsedPercent: number | null;
  deltaPercent: number | null;
  resetObserved: boolean;
}

export interface ThreadTurnUsageSummary {
  hostId: number;
  threadId: string;
  turnId: string;
  usageScope: UsageScope;
  usageSource: UsageSource;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  apiEquivalentCostMicros: number | null;
  pricingVersion: string | null;
  pricingCompleteness: PricingCompleteness;
  providerEstimatedCreditsMicros: number | null;
  providerEstimatedUsdMicros: number | null;
  quotaBefore: CodexRateLimitObservation | null;
  quotaAfter: CodexRateLimitObservation | null;
  quotaDeltas: CodexQuotaWindowDelta[];
  quotaAttributionConfidence: QuotaAttributionConfidence;
  terminalStatus: "completed" | "failed" | "interrupted" | null;
  protocolVersion: string | null;
  protocolSchemaHash: string | null;
  observedAt: number;
}
