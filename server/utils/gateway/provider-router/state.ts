import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProviderRouterRuntimeState } from "./types";
import { normalizeProviderRouting } from "~~/shared/config";
import type { ProviderRoutingSettings } from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";

const DEFAULT_STATE: ProviderRouterRuntimeState = {
  settings: null,
  openaiQuota: "available",
  openaiQuotaDetectedAt: null,
  openaiQuotaResetAt: null,
  openaiQuotaReason: null,
  directDeepseek: "unknown",
  openrouter: "unknown",
  openrouterLastError: null,
  openrouterModels: { text: null, vision: null, fetchedAt: null },
  threadOverrides: {},
};

let loaded = false;
let current: ProviderRouterRuntimeState = clone(DEFAULT_STATE);
let loadedMtimeMs: number | null = null;

export function providerRouterStatePath() {
  const explicit = process.env.CODEX_PROVIDER_ROUTER_STATE_FILE?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;
  const gatewayExplicit = process.env.CODEX_GATEWAY_PROVIDER_ROUTER_STATE_FILE?.trim();
  return gatewayExplicit !== undefined && gatewayExplicit !== ""
    ? gatewayExplicit
    : "/data/provider-router-state.json";
}

export function loadProviderRouterState(): ProviderRouterRuntimeState {
  const path = providerRouterStatePath();
  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    // The state file is optional on first boot.
  }
  if (loaded && mtimeMs === loadedMtimeMs) return current;
  loaded = true;
  loadedMtimeMs = mtimeMs;
  try {
    if (existsSync(path)) {
      const parsed = recordFromUnknown(JSON.parse(readFileSync(path, "utf8")));
      current = mergeState(parsed ?? {});
    }
  } catch (error) {
    console.warn("[provider-router] runtime state could not be loaded", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    current = clone(DEFAULT_STATE);
  }
  return current;
}

export function getProviderRouterState() {
  return loadProviderRouterState();
}

export function updateProviderRouterState(update: (state: ProviderRouterRuntimeState) => void) {
  const next = clone(loadProviderRouterState());
  update(next);
  current = mergeState(next);
  persistProviderRouterState(current);
  return current;
}

export function getThreadProviderRouting(hostId: number, threadId: string) {
  const state = loadProviderRouterState();
  return state.threadOverrides[threadProviderRoutingKey(hostId, threadId)] ?? null;
}

export function setThreadProviderRouting(
  hostId: number,
  threadId: string,
  settings: ProviderRoutingSettings | null,
) {
  const key = threadProviderRoutingKey(hostId, threadId);
  return updateProviderRouterState((state) => {
    if (settings === null) delete state.threadOverrides[key];
    else state.threadOverrides[key] = normalizeProviderRouting(settings);
  });
}

export function threadProviderRoutingKey(hostId: number, threadId: string) {
  return `${hostId}:${threadId}`;
}

export function persistProviderRouterState(state: ProviderRouterRuntimeState) {
  const path = providerRouterStatePath();
  try {
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(mergeState(state), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
    try {
      loadedMtimeMs = statSync(path).mtimeMs;
    } catch {
      loadedMtimeMs = null;
    }
  } catch (error) {
    // Runtime state is advisory. A read-only image or test harness must not make the Gateway
    // unusable; the encrypted config remains the durable source for the two user settings.
    console.warn("[provider-router] runtime state could not be persisted", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function resetProviderRouterStateForTests() {
  loaded = false;
  current = clone(DEFAULT_STATE);
  loadedMtimeMs = null;
}

function mergeState(value: Partial<ProviderRouterRuntimeState>): ProviderRouterRuntimeState {
  return {
    ...clone(DEFAULT_STATE),
    ...value,
    openrouterModels: {
      ...DEFAULT_STATE.openrouterModels,
      ...(value.openrouterModels ?? DEFAULT_STATE.openrouterModels),
    },
    threadOverrides: normalizeThreadOverrides(value.threadOverrides),
  };
}

function normalizeThreadOverrides(value: unknown) {
  const record = recordFromUnknown(value);
  if (record === null) return {};
  const result: ProviderRouterRuntimeState["threadOverrides"] = {};
  for (const [key, candidate] of Object.entries(record)) {
    const settings = recordFromUnknown(candidate);
    if (settings === null) continue;
    const mode = settings.mode;
    if (mode !== "openai" && mode !== "hybrid" && mode !== "deepseek") continue;
    result[key] = normalizeProviderRouting({
      mode,
      useOpenRouterCreditsFirst: settings.useOpenRouterCreditsFirst !== false,
    });
  }
  return result;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
