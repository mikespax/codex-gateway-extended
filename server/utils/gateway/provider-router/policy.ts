import type { TurnStartInput } from "../runtime/types";
import { currentGatewayMemoryState } from "../state/memory";
import { normalizeProviderRouting } from "~~/shared/config";
import { deepSeekPricingPeriod, nextPricingTransition } from "./pricing";
import { turnInputContainsImage } from "./image-detection";
import { deepseekModelForImage, openrouterModelForImage } from "./models";
import { getProviderRouterState, updateProviderRouterState } from "./state";
import type { ProviderDecision, ProviderRouterStatus } from "./types";
import type { ProviderRoutingSettings } from "~~/shared/types";
import { routeProvider } from "./matrix";

// A provider switch must replace a thread's previous DeepSeek model. Passing null to
// thread/resume leaves the app-server's existing model in place, which makes an OpenAI return
// turn fail with "model is not supported when using Codex with a ChatGPT account".
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

export function chooseProvider(
  input: TurnStartInput,
  now = new Date(),
  settingsOverride?: ProviderRoutingSettings | null,
): ProviderDecision {
  let runtime = getProviderRouterState();
  if (
    runtime.openaiQuota === "exhausted" &&
    runtime.openaiQuotaResetAt !== null &&
    Date.parse(runtime.openaiQuotaResetAt) <= now.getTime()
  ) {
    updateProviderRouterState((state) => {
      state.openaiQuota = "available";
      state.openaiQuotaDetectedAt = null;
      state.openaiQuotaResetAt = null;
      state.openaiQuotaReason = null;
    });
    runtime = getProviderRouterState();
  }
  const settings =
    settingsOverride ??
    runtime.settings ??
    normalizeProviderRouting(currentGatewayMemoryState().providerRouting);
  const containsImages = turnInputContainsImage(input);
  const period = deepSeekPricingPeriod(now);
  const matrix = routeProvider({
    mode: settings.mode,
    useOpenRouterCreditsFirst: settings.useOpenRouterCreditsFirst,
    openaiQuota: runtime.openaiQuota,
    openrouter: runtime.openrouter,
    period,
    containsImages,
    requestedOpenAiModel: openAiModelForInput(input.model),
    openRouterTextModel: openrouterModelForImage(false),
    openRouterVisionModel: openrouterModelForImage(true),
    directTextModel: deepseekModelForImage(false),
    directVisionModel: deepseekModelForImage(true),
  });
  return {
    mode: settings.mode,
    logicalProvider: "openai",
    effectiveProvider: matrix.effectiveProvider,
    transport: matrix.transport,
    model: matrix.model,
    containsImages,
    deepseekPeriod: period,
    reason: matrix.reason,
  };
}

export function providerRouterStatus(
  now = new Date(),
  settingsOverride?: ProviderRoutingSettings | null,
): ProviderRouterStatus {
  const runtime = getProviderRouterState();
  const settings =
    settingsOverride ??
    runtime.settings ??
    normalizeProviderRouting(currentGatewayMemoryState().providerRouting);
  const period = deepSeekPricingPeriod(now);
  const matrix = routeProvider({
    mode: settings.mode,
    useOpenRouterCreditsFirst: settings.useOpenRouterCreditsFirst,
    openaiQuota: runtime.openaiQuota,
    openrouter: runtime.openrouter,
    period,
    containsImages: false,
    requestedOpenAiModel: null,
    openRouterTextModel: openrouterModelForImage(false),
    openRouterVisionModel: openrouterModelForImage(true),
    directTextModel: deepseekModelForImage(false),
    directVisionModel: deepseekModelForImage(true),
  });
  const effectiveProvider = matrix.effectiveProvider;
  const containsImages = false;
  const transport = matrix.transport;
  return {
    mode: settings.mode,
    useOpenRouterCreditsFirst: settings.useOpenRouterCreditsFirst,
    logicalProvider: "openai",
    effectiveProvider,
    transport,
    model: matrix.model,
    containsImages,
    deepseekPeriod: period,
    nextPricingTransitionAt: nextPricingTransition(now).toISOString(),
    openaiQuota: runtime.openaiQuota,
    openrouter: runtime.openrouter,
    directDeepseek: runtime.directDeepseek,
    reason: matrix.reason,
  };
}

/** Parameters used for thread/start, before a new rollout exists to accept thread/resume. */
export function providerStartParameters(model: string | null | undefined, now = new Date()) {
  const status = providerRouterStatus(now);
  const runtime = getProviderRouterState();
  // Hybrid thread/start only creates the logical Codex identity; it does not run inference. Keep
  // that materialization on the stock OpenAI provider so a host that has not provisioned a
  // DeepSeek key (or whose long-lived app-server has not reloaded the provider table) can still
  // create a chat. The first turn applies the actual hybrid decision through thread/resume and
  // the guarded fallback path. DeepSeek-only remains strict and starts on DeepSeek directly.
  if (status.mode === "hybrid") {
    return {
      modelProvider: "openai" as const,
      model: openAiModelForInput(model),
    };
  }
  const transport =
    status.transport === "openrouter" && runtime.openrouter !== "available"
      ? "deepseek"
      : status.transport;
  return {
    modelProvider: transport === "openai" ? "openai" : transport,
    model:
      transport === "openai"
        ? openAiModelForInput(model)
        : transport === "openrouter"
          ? (status.model ?? undefined)
          : deepseekModelForImage(false),
  };
}

function openAiModelForInput(model: string | null | undefined) {
  return model !== null && model !== undefined && model !== "" && !model.startsWith("deepseek")
    ? model
    : DEFAULT_OPENAI_MODEL;
}
