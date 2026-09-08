import type { ProviderDecision } from "./types";
import { currentGatewayUserId } from "../state/memory";
import { updateProviderRouterState } from "./state";
import { recordFromUnknown } from "../../../../shared/utils/records";

export function observeProviderFailure(
  hostId: number,
  threadId: string,
  method: string,
  params: unknown,
) {
  if (method !== "error" && method !== "turn/completed") return;
  if (lastThreadRoute(hostId, threadId)?.transport !== "openrouter") return;
  const record = recordFromUnknown(params);
  if (!record) return;
  const turn = recordFromUnknown(record.turn);
  const error = record.error ?? turn?.error;
  if (error === null || error === undefined) return;
  const message = JSON.stringify(error).toLowerCase();
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
