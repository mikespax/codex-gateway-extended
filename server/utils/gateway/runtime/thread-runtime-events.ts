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

type ThreadEventSubscriber = (event: GatewayEvent) => void;
export type ThreadGoalResolver = () => Promise<unknown>;
export type ThreadMetadataResolver = () => Promise<unknown>;

class ThreadRuntimeEventBus {
  private readonly subscribers = new Map<string, Set<ThreadEventSubscriber>>();

  record(
    hostId: number,
    threadId: string,
    method: string,
    payload: RpcEnvelope,
    options: { resolveGoal?: ThreadGoalResolver; resolveThread?: ThreadMetadataResolver } = {},
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
    if (status === null) return;
    const params = recordFromUnknown(event.payload.params);
    const turn = recordFromUnknown(params?.turn);
    const turnId = idFromUnknown(turn?.id);
    threadRuntimeStatusHub.publish(currentUserId(), {
      hostId: event.hostId,
      threadId: event.threadId,
      status,
      turnId: status === "running" && turnId !== null ? String(turnId) : null,
    });
  }

  private key(userId: number, hostId: number, threadId: string) {
    return `${userId}:${hostId}:${threadId}`;
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
