import { threadTurnUsageFromUnknown } from "~~/shared/runtime/usage-accounting";
import { gatewayDomainEvents } from "../domain-events";
import type { GatewayEventHandlerRegistry } from "./types";

export const usageEventHandlers: GatewayEventHandlerRegistry = {
  "gateway/usage/turn": (event, params) => {
    const usage = threadTurnUsageFromUnknown(params.usage);
    if (usage === null) return;
    gatewayDomainEvents.emit("thread-turn-usage-detected", {
      hostId: event.hostId,
      usage,
    });
  },
};
