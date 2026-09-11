export type RoutingMode = "openai" | "hybrid" | "deepseek";
export type PricePeriod = "peak" | "off_peak";
export type QuotaState = "available" | "exhausted" | "unknown";
export type DeepSeekTransport = "openrouter" | "deepseek";

export interface RoutingMatrixInput {
  mode: RoutingMode;
  useOpenRouterCreditsFirst: boolean;
  openaiQuota: QuotaState;
  openrouter: "available" | "exhausted" | "unavailable" | "unknown";
  period: PricePeriod;
  containsImages: boolean;
  requestedOpenAiModel: string | null;
  openRouterTextModel: string;
  openRouterVisionModel: string;
  directTextModel: string;
  directVisionModel: string;
}

export interface RoutingMatrixDecision {
  effectiveProvider: "openai" | "deepseek";
  transport: "openai" | DeepSeekTransport;
  model: string | null;
  reason: string;
}

/** Pure routing matrix; keeping it independent of Gateway state makes every branch testable. */
export function routeProvider(input: RoutingMatrixInput): RoutingMatrixDecision {
  const useDeepSeek =
    input.mode === "deepseek" ||
    (input.mode === "hybrid" && (input.period === "off_peak" || input.openaiQuota === "exhausted"));
  if (!useDeepSeek) {
    return {
      effectiveProvider: "openai",
      transport: "openai",
      model: input.requestedOpenAiModel,
      reason: input.mode === "openai" ? "openai_only" : "openai_peak",
    };
  }
  const transport: DeepSeekTransport =
    input.useOpenRouterCreditsFirst &&
    (input.openrouter === "available" || input.openrouter === "unknown")
      ? "openrouter"
      : "deepseek";
  return {
    effectiveProvider: "deepseek",
    transport,
    model:
      transport === "openrouter"
        ? input.containsImages
          ? input.openRouterVisionModel
          : input.openRouterTextModel
        : input.containsImages
          ? input.directVisionModel
          : input.directTextModel,
    reason:
      input.openaiQuota === "exhausted"
        ? transport === "openrouter"
          ? "openai_quota_exhausted_fallback_openrouter"
          : "openai_quota_exhausted_fallback_direct"
        : input.mode === "deepseek"
          ? transport === "openrouter"
            ? "deepseek_only_openrouter"
            : "deepseek_only_direct"
          : transport === "openrouter"
            ? "deepseek_off_peak_openrouter"
            : "deepseek_off_peak_direct",
  };
}
