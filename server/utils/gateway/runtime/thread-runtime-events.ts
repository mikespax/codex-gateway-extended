import type { GatewayEvent, RpcEnvelope } from "~~/shared/types";
import { parseRpcEnvelope } from "~~/shared/runtime/app-server";
import { gatewayEventStore } from "../state/gateway-events";
import { currentGatewayUserId } from "../state/memory";
import { subAgentThreadStore } from "../state/sub-agent-threads";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { dispatchThreadRuntimeNotification } from "../notifications/thread-notification-dispatcher";
import { applyEventToOpenSnapshot } from "./open-snapshot-events";
import { runtimeStatusFromEvent } from "~~/shared/thread-runtime-status";
import { idFromUnknown, recordFromUnknown } from "~~/shared/utils/records";
import { threadRuntimeStatusHub } from "./thread-runtime-status-hub";
import { runtimeLog } from "./runtime-log";
import { turnUsageAccounting } from "../usage/turn-usage-accounting";
import type { RateLimitsResolver } from "../usage/turn-usage-accounting";

type ThreadEventSubscriber = (event: GatewayEvent) => void;
export type ThreadGoalResolver = () => Promise<unknown>;
export type ThreadMetadataResolver = () => Promise<unknown>;
export interface ThreadRuntimeAccountingOptions {
  resolveRateLimits?: RateLimitsResolver;
  resolveThreadUsage?: RateLimitsResolver;
  protocolVersion?: string | null;
  protocolSchemaHash?: string | null;
}

class ThreadRuntimeEventBus {
  private readonly subscribers = new Map<string, Set<ThreadEventSubscriber>>();

  record(
    hostId: number,
    threadId: string,
    method: string,
    payload: RpcEnvelope,
    options: {
      resolveGoal?: ThreadGoalResolver;
      resolveThread?: ThreadMetadataResolver;
    } & ThreadRuntimeAccountingOptions = {},
  ) {
    const envelope = parseRpcEnvelope(payload);
    const event = gatewayEventStore.add(hostId, threadId, method, envelope);
    subAgentThreadStore.recordRuntimeEvent(hostId, threadId, method, envelope);
    threadSnapshotStore.update(hostId, threadId, (snapshot) =>
      applyEventToOpenSnapshot(snapshot, method, envelope, event.createdAt),
    );
    this.publish(event);
    this.publishRuntimeStatus(event);
    dispatchThreadRuntimeNotification(event, options);
    void turnUsageAccounting.observeEvent(event, options).catch((error) => {
      runtimeLog("turn usage accounting failed", {
        hostId,
        threadId,
        method,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return event;
  }

  subscribe(hostId: number, threadId: string, subscriber: ThreadEventSubscriber) {
    const key = this.key(currentUserId(), hostId, threadId);
    let subscribers = this.subscribers.get(key);
    if (subscribers === undefined) {
      subscribers = new Set();
      this.subscribers.set(key, subscribers);
    }
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  private publish(event: GatewayEvent) {
    for (const subscriber of this.subscribers.get(
      this.key(currentUserId(), event.hostId, event.threadId),
    ) ?? []) {
      subscriber(event);
    }
  }

  private publishRuntimeStatus(event: GatewayEvent) {
    const status = runtimeStatusFromEvent(event);
    const currentOperation = sidebarOperationFromEvent(event);
    if (status === null && currentOperation === null) return;
    const params = recordFromUnknown(event.payload.params);
    const turn = recordFromUnknown(params?.turn);
    const turnId = idFromUnknown(turn?.id);
    threadRuntimeStatusHub.publish(currentUserId(), {
      hostId: event.hostId,
      threadId: event.threadId,
      status: status ?? "running",
      turnId: status === "running" && turnId !== null ? String(turnId) : null,
      currentOperation,
    });
  }

  private key(userId: number, hostId: number, threadId: string) {
    return `${userId}:${hostId}:${threadId}`;
  }
}

/**
 * Keep background sidebar updates small and non-sensitive. Full transcript events remain scoped
 * to an opened thread; only a stable action label is fanned out to the global runtime channel.
 */
function sidebarOperationFromEvent(event: GatewayEvent) {
  switch (event.method) {
    case "turn/started":
      return "Working";
    case "item/agentMessage/delta":
      return "Writing a response";
    case "item/plan/delta":
    case "turn/plan/updated":
      return "Planning the next steps";
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return "Thinking through the change";
    case "item/commandExecution/outputDelta":
      return "Running a command";
    case "item/fileChange/patchUpdated":
      return "Updating files";
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return "Waiting approval";
    case "item/started": {
      const params = recordFromUnknown(event.payload.params);
      const item = recordFromUnknown(params?.item);
      return operationForItemType(item?.type);
    }
    case "thread/status/changed": {
      return runtimeStatusFromEvent(event) === "running" ? "Working" : null;
    }
    default:
      return null;
  }
}

function operationForItemType(value: unknown) {
  switch (value) {
    case "commandExecution":
      return "Running a command";
    case "fileChange":
      return "Updating files";
    case "webSearch":
      return "Searching the web";
    case "agentMessage":
      return "Writing a response";
    case "reasoning":
      return "Thinking through the change";
    case "plan":
    case "turnPlan":
      return "Planning the next steps";
    case "imageGeneration":
      return "Generating an image";
    case "mcpToolCall":
    case "dynamicToolCall":
      return "Using a tool";
    case "subAgentActivity":
    case "collabAgentToolCall":
      return "Running sub-agents";
    case "sleep":
      return "Sleeping";
    case "permissionsRequest":
    case "serverRequest":
    case "requestUserInput":
      return "Waiting for input";
    case "hookPrompt":
      return "Running a hook";
    case "contextCompaction":
      return "Compacting context";
    default:
      return null;
  }
}

function currentUserId() {
  const userId = currentGatewayUserId();
  if (userId === null) {
    throw new Error("Thread runtime events require an authenticated user scope");
  }
  return userId;
}

export const threadRuntimeEvents = new ThreadRuntimeEventBus();
