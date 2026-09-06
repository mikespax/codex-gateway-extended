import type { GatewayEvent } from "~~/shared/types";
import { threadHistoryItemFromUnknown } from "~~/shared/runtime/app-server";
import { idFromUnknown, stringFromUnknown, stringIdFromUnknown } from "~~/shared/utils/records";
import { gatewayDomainEvents } from "../domain-events";
import { tagFileChanges } from "./file-change-sequence";
import type { AppServerEventParams, GatewayEventHandlerRegistry } from "./types";
import {
  itemLifecycleTimestampMs,
  type ItemLifecyclePhase,
} from "~~/shared/thread-history/item-lifecycle-timing";

export const itemEventHandlers: GatewayEventHandlerRegistry = {
  "item/started": (event, params, threadId) => {
    emitRunning(event, params, threadId);
    upsertStartedOrCompletedItem(event, params, threadId, "started");
  },
  "item/completed": (event, params, threadId) => {
    upsertStartedOrCompletedItem(event, params, threadId, "completed");
    emitTerminalProcessCompleted(event, params, threadId);
    emitRemoteFilesChanged(event, params, threadId);
  },
  "item/commandExecution/requestApproval": (event, params, threadId) => {
    const itemId = idFromUnknown(params.itemId);
    const turnId = idFromUnknown(params.turnId);
    if (itemId === null || turnId === null) return;
    gatewayDomainEvents.emit("history-item-upsert", {
      hostId: event.hostId,
      threadId,
      item: {
        type: "commandExecution",
        id: itemId,
        turnId,
        status: "waitingForApproval",
        command: stringFromUnknown(params.command),
        cwd: stringFromUnknown(params.cwd),
        pendingApproval: { requestId: event.payload.id, method: event.method, params },
      },
    });
  },
  "item/fileChange/requestApproval": (event, params, threadId) => {
    const itemId = idFromUnknown(params.itemId);
    const turnId = idFromUnknown(params.turnId);
    if (itemId === null || turnId === null) return;
    gatewayDomainEvents.emit("history-item-upsert", {
      hostId: event.hostId,
      threadId,
      item: {
        type: "fileChange",
        id: itemId,
        turnId,
        status: "waitingForApproval",
        pendingApproval: { requestId: event.payload.id, method: event.method, params },
      },
    });
  },
  "item/fileChange/patchUpdated": (event, params, threadId) => {
    emitRunning(event, params, threadId);
    const itemId = idFromUnknown(params.itemId);
    const turnId = idFromUnknown(params.turnId);
    if (itemId === null || turnId === null) return;
    gatewayDomainEvents.emit("history-item-upsert", {
      hostId: event.hostId,
      threadId,
      item: {
        type: "fileChange",
        id: itemId,
        turnId,
        changes: tagFileChanges(params.changes),
        status: "inProgress",
      },
    });
  },
};

function emitRunning(event: GatewayEvent, params: AppServerEventParams, threadId: string) {
  gatewayDomainEvents.emit("thread-status-detected", {
    hostId: event.hostId,
    threadId,
    status: "running",
    turnId: stringIdFromUnknown(params.turnId),
  });
}

function emitTerminalProcessCompleted(
  event: GatewayEvent,
  params: AppServerEventParams,
  threadId: string,
) {
  const item = threadHistoryItemFromUnknown(params.item);
  const turnId = idFromUnknown(params.turnId);
  if (item?.type !== "commandExecution" || turnId === null || item.id == null) return;
  gatewayDomainEvents.emit("terminal-process-completed", {
    hostId: event.hostId,
    threadId,
    turnId: String(turnId),
    itemId: String(item.id),
  });
}

function emitRemoteFilesChanged(
  event: GatewayEvent,
  params: AppServerEventParams,
  threadId: string,
) {
  const item = threadHistoryItemFromUnknown(params.item);
  if (item?.type !== "fileChange") return;
  const paths = [
    ...new Set(
      (Array.isArray(item.changes) ? item.changes : []).flatMap((change: Record<string, unknown>) =>
        [change.path, change.filePath, change.pathBefore, change.pathAfter].filter(
          (path: unknown): path is string => typeof path === "string" && path.length > 0,
        ),
      ),
    ),
  ];
  if (paths.length > 0)
    gatewayDomainEvents.emit("remote-files-changed", { hostId: event.hostId, threadId, paths });
}

function upsertStartedOrCompletedItem(
  event: GatewayEvent,
  params: AppServerEventParams,
  threadId: string,
  phase: ItemLifecyclePhase,
) {
  const item = threadHistoryItemFromUnknown(params.item);
  if (item === null) return;
  const turnId = idFromUnknown(params.turnId);
  const lifecycleTimestamp = itemLifecycleTimestampMs(params, phase);
  gatewayDomainEvents.emit("history-item-upsert", {
    hostId: event.hostId,
    threadId,
    item: {
      ...item,
      turnId,
      status: item.status ?? (phase === "started" ? "inProgress" : "completed"),
      ...(phase === "started" ? { startedAt: lifecycleTimestamp } : {}),
      ...(phase === "completed" ? { completedAt: lifecycleTimestamp } : {}),
    },
  });
}
