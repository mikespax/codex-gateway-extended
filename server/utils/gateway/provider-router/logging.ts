import type { ProviderDecision } from "./types";
import { currentGatewayUserId } from "../state/memory";
import { updateProviderRouterState } from "./state";
import { recordFromUnknown, stringFromUnknown } from "../../../../shared/utils/records";

export function observeProviderFailure(
  hostId: number,
  threadId: string,
  method: string,
  params: unknown,
) {
  if (method !== "error" && method !== "turn/completed") return;
  const route = lastThreadRoute(hostId, threadId);
  if (route === null) return;
  const record = recordFromUnknown(params);
  if (!record) return;
  const turn = recordFromUnknown(record.turn);
  const error = record.error ?? turn?.error;
  const message = error === null || error === undefined ? "" : JSON.stringify(error).toLowerCase();
  const status = stringFromUnknown(turn?.status) ?? stringFromUnknown(record.status);

  if (route.transport === "deepseek") {
    // turn/start only proves that the app-server accepted the request. The provider is not
    // healthy until the same turn reaches a clean terminal completion. This avoids reporting
    // DeepSeek as available when the turn immediately fails due to missing credentials/model
    // configuration, which is especially important for fail-closed DeepSeek-only mode.
    if (method === "turn/completed" && status === "completed" && error === undefined) {
      updateProviderRouterState((state) => {
        state.directDeepseek = "available";
      });
      return;
    }
    if (method === "turn/completed" && status === "failed") {
      updateProviderRouterState((state) => {
        if (isDeepSeekTransportFailure(message)) state.directDeepseek = "unavailable";
        else if (state.directDeepseek === "available") state.directDeepseek = "unknown";
      });
      return;
    }
    if (isDeepSeekTransportFailure(message)) {
      updateProviderRouterState((state) => {
        state.directDeepseek = "unavailable";
      });
    }
    return;
  }

  if (route.transport !== "openrouter" || error === null || error === undefined) return;
  if (
    !/insufficient.*(?:credit|balance)|(?:credit|balance).*(?:exhaust|deplet|insufficient)|payment required/.test(
      message,
    )
  )
    return;
  updateProviderRouterState((state) => {
    state.openrouter = "exhausted";
    state.openrouterLastError = "openrouter_credit_exhausted";
  });
}

function isDeepSeekTransportFailure(message: string) {
  return /deepseek.*(?:missing|not configured|unavailable|unauthori[sz]ed|forbidden|api[ _-]?key)|(?:missing|invalid|unauthori[sz]ed|forbidden).*(?:api[ _-]?key|provider|deepseek)|(?:provider|model).*(?:not found|unavailable|unknown)/.test(
    message,
  );
}

const routes = new Map<string, ProviderDecision & { recordedAt: string }>();
export function lastThreadRoute(hostId: number, threadId: string) {
  return routes.get(`${currentGatewayUserId()}:${hostId}:${threadId}`) ?? null;
}

export function logProviderDecision(
  requestId: string,
  threadId: string,
  decision: ProviderDecision,
  details: {
    hostId?: number;
    status?: string;
    durationMs?: number;
    fallbackReason?: string | null;
  } = {},
) {
  if (details.hostId !== undefined && details.status === "200") {
    const key = `${currentGatewayUserId()}:${details.hostId}:${threadId}`;
    routes.delete(key);
    routes.set(key, { ...decision, recordedAt: new Date().toISOString() });
    if (routes.size > 500) routes.delete(routes.keys().next().value!);
  }
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
