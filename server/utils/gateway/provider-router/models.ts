import { getProviderRouterState, updateProviderRouterState } from "./state";
import { recordFromUnknown } from "~~/shared/utils/records";

// DeepSeek V4.1 Flash is the current API model and has native multimodal support.
// Keep one explicit model for text and image turns; the older V4 slugs are compatibility
// aliases and should not be the Gateway's preferred request identifiers.
export const DIRECT_DEEPSEEK_TEXT_MODEL = "deepseek-flash";
export const DIRECT_DEEPSEEK_VISION_MODEL = "deepseek-flash";
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

const OPENROUTER_CURRENT_FLASH_MODEL = "deepseek/deepseek-v4.1-flash";

export function deepseekModelForImage(containsImages: boolean) {
  return containsImages ? DIRECT_DEEPSEEK_VISION_MODEL : DIRECT_DEEPSEEK_TEXT_MODEL;
}

export function openrouterModelForImage(containsImages: boolean) {
  const cached = getProviderRouterState().openrouterModels;
  return (
    (containsImages
      ? isSupportedOpenRouterFlashModel(cached.vision)
        ? cached.vision
        : null
      : isSupportedOpenRouterFlashModel(cached.text)
        ? cached.text
        : null) ?? OPENROUTER_CURRENT_FLASH_MODEL
  );
}

/** Public model discovery is cached for six hours; the request never contains a user secret. */
export async function refreshOpenRouterModels(force = false) {
  const cached = getProviderRouterState().openrouterModels;
  if (
    !force &&
    isSupportedOpenRouterFlashModel(cached.text) &&
    cached.fetchedAt !== null &&
    Date.now() - Date.parse(cached.fetchedAt) < MODEL_CACHE_TTL_MS
  ) {
    return cached;
  }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`OpenRouter model discovery returned HTTP ${response.status}`);
    const body = recordFromUnknown(await response.json());
    const models = Array.isArray(body?.data) ? body.data : [];
    const ids = models
      .map((model) => ({
        id: recordFromUnknown(model)?.id,
      }))
      .filter((model): model is { id: string } => typeof model.id === "string");
    const vision = chooseModel(
      ids.map((model) => model.id),
      true,
    );
    const text = chooseModel(
      ids.map((model) => model.id),
      false,
    );
    const next = updateProviderRouterState((state) => {
      state.openrouterModels = {
        text: text ?? state.openrouterModels.text,
        vision: vision ?? state.openrouterModels.vision,
        fetchedAt: new Date().toISOString(),
      };
    });
    return next.openrouterModels;
  } catch (error) {
    console.warn("[provider-router] OpenRouter model discovery unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return getProviderRouterState().openrouterModels;
  }
}

function chooseModel(ids: string[], vision: boolean) {
  const candidates = ids.filter((id) => {
    const normalized = id.toLowerCase();
    if (!normalized.includes("deepseek") || !normalized.includes("flash")) return false;
    if (normalized.includes(":")) return false;
    if (normalized.startsWith("~")) return false;
    if (vision) return normalized.includes("v4.1-flash") || normalized.includes("vision");
    return !normalized.includes("vision");
  });
  const preferred = vision
    ? [OPENROUTER_CURRENT_FLASH_MODEL, "deepseek/deepseek-v4-flash-vision-exp"]
    : [
        OPENROUTER_CURRENT_FLASH_MODEL,
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-0731",
      ];
  return preferred.find((id) => candidates.includes(id)) ?? candidates.sort()[0] ?? null;
}

function isSupportedOpenRouterFlashModel(model: string | null) {
  if (model === null) return false;
  const normalized = model.toLowerCase();
  return (
    normalized.includes("deepseek") && normalized.includes("flash") && !normalized.includes(":")
  );
}
