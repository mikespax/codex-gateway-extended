import type { GatewayEvent } from "~~/shared/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { threadIdFromParams } from "../thread-utils/identity";
import { appServerEventDispatcher } from "./registry";
import { idFromUnknown, recordFromUnknown } from "~~/shared/utils/records";

const transientErrorRecoveryBlockedMethods = new Set(["error"]);

export function applyAppServerEvent(event: GatewayEvent) {
  const params = recordFromUnknown(event.payload.params) ?? {};
  const targetThreadId = threadIdFromParams(params) ?? event.threadId;
  if (targetThreadId === null || targetThreadId === "") return;
  const threadId = String(targetThreadId);
  clearRecoveredTransientError(event, params, threadId);
  appServerEventDispatcher.dispatch(event.method, { event, params, threadId });
}

function clearRecoveredTransientError(
  event: GatewayEvent,
  params: Record<string, unknown>,
  threadId: string,
) {
  const gateway = useGatewayBootstrapStore();
  const current = gateway.error;
  if (current?.transient !== true || transientErrorRecoveryBlockedMethods.has(event.method)) return;
  const value = params.turnId ?? recordFromUnknown(params.turn)?.id;
  const eventTurnIdValue = idFromUnknown(value);
  const eventTurnId = eventTurnIdValue === null ? null : String(eventTurnIdValue);
  if (
    eventTurnId !== null &&
    current.turnId === eventTurnId &&
    current.hostId === event.hostId &&
    current.threadId === threadId
  ) {
    gateway.clearError();
  }
}
