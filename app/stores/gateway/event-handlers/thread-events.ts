import { normalizeTokenUsage } from "~~/shared/token-usage";
import {
  appServerThreadFromUnknown,
  threadSettingsFromAppServer,
} from "~~/shared/runtime/app-server";
import { gatewayDomainEvents } from "../domain-events";
import { threadIdFromParams } from "../thread-utils/identity";
import { runtimeStatusFromAppThreadStatus } from "../thread-utils/status";
import type { GatewayEventHandlerRegistry } from "./types";

export const threadEventHandlers: GatewayEventHandlerRegistry = {
  "thread/started": (event, params) => {
    const thread = appServerThreadFromUnknown(params.thread);
    if (thread !== null) {
      gatewayDomainEvents.emit("thread-summary-detected", {
        hostId: event.hostId,
        thread,
      });
    }
  },
  "thread/status/changed": (event, params) => {
    const threadId = threadIdFromParams(params);
    if (threadId !== null) {
      gatewayDomainEvents.emit("thread-status-detected", {
        hostId: event.hostId,
        threadId: String(threadId),
        status: runtimeStatusFromAppThreadStatus(params.status),
      });
    }
  },
  "thread/settings/updated": (event, params) => {
    const threadId = threadIdFromParams(params);
    const settings = threadSettingsFromAppServer(params.threadSettings);
    if (threadId !== null && settings !== null) {
      gatewayDomainEvents.emit("thread-settings-detected", {
        hostId: event.hostId,
        threadId: String(threadId),
        settings,
      });
    }
  },
  "thread/tokenUsage/updated": (event, params) => {
    const threadId = threadIdFromParams(params);
    const tokenUsage = normalizeTokenUsage(params.tokenUsage);
    if (threadId !== null && tokenUsage !== null) {
      gatewayDomainEvents.emit("thread-token-usage-detected", {
        hostId: event.hostId,
        threadId: String(threadId),
        tokenUsage,
      });
    }
  },
};
