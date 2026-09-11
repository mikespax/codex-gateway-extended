/** User-facing provider policy. Keep this deliberately small; transports and model ids are
 * implementation details and must not become additional primary UI modes. */
export type ProviderRoutingMode = "openai" | "hybrid" | "deepseek";

export interface ProviderRoutingSettings {
  mode: ProviderRoutingMode;
  useOpenRouterCreditsFirst: boolean;
}

/** A complete per-thread override. Missing entries inherit the global policy. */
export type ThreadProviderRoutingOverride = ProviderRoutingSettings;

export type ProviderQuotaState = "available" | "exhausted" | "unknown";
export type ProviderAvailability = "available" | "exhausted" | "unavailable" | "unknown";

export interface ProviderRoutingStatus {
  mode: ProviderRoutingMode;
  useOpenRouterCreditsFirst: boolean;
  logicalProvider: "openai" | "deepseek";
  effectiveProvider: "openai" | "deepseek";
  transport: "openai" | "openrouter" | "deepseek";
  model: string | null;
  containsImages: boolean;
  deepseekPeriod: "peak" | "off_peak";
  nextPricingTransitionAt: string;
  openaiQuota: ProviderQuotaState;
  openrouter: ProviderAvailability;
  directDeepseek: ProviderAvailability;
  reason: string;
}
