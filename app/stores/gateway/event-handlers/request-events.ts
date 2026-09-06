import { itemTypeForServerRequest, SERVER_REQUEST_ITEM_TYPES } from "~~/shared/server-requests";
import { idFromUnknown } from "~~/shared/utils/records";
import { gatewayDomainEvents } from "../domain-events";
import type { GatewayEventHandlerRegistry } from "./types";

const pendingServerRequestHandlers = Object.fromEntries(
  Object.keys(SERVER_REQUEST_ITEM_TYPES).map((method) => [method, upsertPendingServerRequest]),
) satisfies GatewayEventHandlerRegistry;

export const requestEventHandlers: GatewayEventHandlerRegistry = {
  ...pendingServerRequestHandlers,
  "serverRequest/resolved": (event, params, threadId) => {
    const requestId = idFromUnknown(params.requestId);
    if (requestId === null) return;
    gatewayDomainEvents.emit("history-server-request-resolved", {
      hostId: event.hostId,
      threadId,
      requestId,
    });
  },
  "currentTime/read": () => {
    // Answered by the shared gateway RPC connection before browser event routing.
  },
};

function upsertPendingServerRequest(
  event: Parameters<GatewayEventHandlerRegistry[string]>[0],
  params: Parameters<GatewayEventHandlerRegistry[string]>[1],
  threadId: string,
) {
  const turnId = idFromUnknown(params.turnId);
  const stableItemId = idFromUnknown(params.itemId) ?? idFromUnknown(event.payload.id);
  if (stableItemId === null) return;
  gatewayDomainEvents.emit("history-item-upsert", {
    hostId: event.hostId,
    threadId,
    item: {
      type: itemTypeForServerRequest(event.method),
      id: `server-request-${String(stableItemId)}`,
      turnId: turnId ?? `server-request-turn-${String(stableItemId)}`,
      status: "waitingForClient",
      requestId: event.payload.id,
      method: event.method,
      params,
    },
  });
}
