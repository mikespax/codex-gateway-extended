import type {
  ProviderAvailability,
  ProviderQuotaState,
  ProviderRoutingMode,
  ProviderRoutingSettings,
} from "~~/shared/types";

export type EffectiveProvider = "openai" | "deepseek";
export type ProviderTransport = "openai" | "openrouter" | "deepseek";
export type DeepSeekPricePeriod = "peak" | "off_peak";

export interface ProviderDecision {
  mode: ProviderRoutingMode;
  logicalProvider: EffectiveProvider;
  effectiveProvider: EffectiveProvider;
  transport: ProviderTransport;
  model: string | null;
  containsImages: boolean;
  deepseekPeriod: DeepSeekPricePeriod;
  reason: string;
}

export interface ProviderRouterRuntimeState {
  settings: ProviderRoutingSettings | null;
  openaiQuota: ProviderQuotaState;
  openaiQuotaDetectedAt: string | null;
  openaiQuotaResetAt: string | null;
  openaiQuotaReason: string | null;
  directDeepseek: ProviderAvailability;
  openrouter: ProviderAvailability;
  openrouterLastError: string | null;
  openrouterModels: {
    text: string | null;
    vision: string | null;
    fetchedAt: string | null;
  };
}

export interface ProviderRouterStatus extends ProviderDecision {
  useOpenRouterCreditsFirst: boolean;
  nextPricingTransitionAt: string;
  openaiQuota: ProviderQuotaState;
  openrouter: ProviderAvailability;
  directDeepseek: ProviderAvailability;
}
