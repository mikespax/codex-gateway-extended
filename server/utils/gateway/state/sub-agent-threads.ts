import type { AppServerThread, RpcEnvelope, ThreadHistoryItem } from "~~/shared/types";
import {
  isAppServerSubAgentThread,
  threadHistoryItemFromUnknown,
} from "~~/shared/runtime/app-server";
import { recordFromUnknown } from "~~/shared/utils/records";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { gatewayMemoryState, nowIso } from "./memory";

export const subAgentThreadStore = {
  pruneToHosts(hostIds: Set<number>) {
    gatewayMemoryState.subAgentThreads = gatewayMemoryState.subAgentThreads.filter((thread) =>
      hostIds.has(thread.hostId),
    );
  },

  deleteForHost(hostId: number) {
    gatewayMemoryState.subAgentThreads = gatewayMemoryState.subAgentThreads.filter(
      (thread) => thread.hostId !== hostId,
    );
  },

  record(hostId: number, threadId: string, parentThreadId: string | null = null) {
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId === "") {
      return;
    }
    const updatedAt = nowIso();
    const index = gatewayMemoryState.subAgentThreads.findIndex(
      (thread) => thread.hostId === hostId && thread.threadId === normalizedThreadId,
    );
    if (index >= 0) {
      const existing = gatewayMemoryState.subAgentThreads[index];
      if (existing === undefined) {
        return;
      }
      gatewayMemoryState.subAgentThreads[index] = {
        ...existing,
        parentThreadId: parentThreadId ?? existing.parentThreadId,
        updatedAt,
      };
      return;
    }
    gatewayMemoryState.subAgentThreads.push({
      hostId,
      threadId: normalizedThreadId,
      parentThreadId,
      updatedAt,
    });
  },

  recordThreadMetadata(hostId: number, thread: AppServerThread) {
    if (!isSubAgentThreadMetadata(thread)) {
      return;
    }
    this.record(hostId, String(thread.id), parentThreadIdFromMetadata(thread));
  },

  recordRuntimeEvent(hostId: number, parentThreadId: string, method: string, payload: RpcEnvelope) {
    for (const threadId of subAgentThreadIdsFromRuntimeEvent(method, payload)) {
      this.record(hostId, threadId, parentThreadId);
    }
  },

  isSubAgentThread(hostId: number, threadId: string) {
    return gatewayMemoryState.subAgentThreads.some(
      (thread) => thread.hostId === hostId && thread.threadId === threadId,
    );
  },
};

function isSubAgentThreadMetadata(thread: AppServerThread) {
  return isAppServerSubAgentThread(thread);
}

export function parentThreadIdFromMetadata(thread: AppServerThread) {
  const parentThreadId = thread.parentThreadId;
  return typeof parentThreadId === "string" ? trimmedOrNull(parentThreadId) : null;
}

function subAgentThreadIdsFromRuntimeEvent(method: string, payload: RpcEnvelope) {
  if (method !== "item/started" && method !== "item/completed") {
    return [];
  }
  const item = threadHistoryItemFromUnknown(recordFromUnknown(payload.params)?.item);
  return item === null ? [] : subAgentThreadIdsFromItem(item);
}

function subAgentThreadIdsFromItem(item: ThreadHistoryItem) {
  if (item.type !== "subAgentActivity") {
    return [];
  }
  return typeof item.agentThreadId === "string" && item.agentThreadId.trim() !== ""
    ? [item.agentThreadId.trim()]
    : [];
}
