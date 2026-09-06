import { gatewayMemoryState, toTimestamp } from "./memory";
import { parentThreadIdFromMetadata, subAgentThreadStore } from "./sub-agent-threads";
import type { AppServerThread } from "~~/shared/types";

export const threadMetadataStore = {
  pruneToHosts(hostIds: Set<number>) {
    gatewayMemoryState.threadMetadata = gatewayMemoryState.threadMetadata.filter((thread) =>
      hostIds.has(thread.hostId),
    );
  },

  deleteForHost(hostId: number) {
    gatewayMemoryState.threadMetadata = gatewayMemoryState.threadMetadata.filter(
      (thread) => thread.hostId !== hostId,
    );
  },

  get(hostId: number, threadId: string) {
    return (
      gatewayMemoryState.threadMetadata.find(
        (thread) => thread.hostId === hostId && thread.threadId === threadId,
      ) ?? null
    );
  },

  record(hostId: number, projectId: number | null, thread: AppServerThread) {
    const threadId = thread.id;
    subAgentThreadStore.recordThreadMetadata(hostId, thread);
    const timestamp = Math.floor(Date.now() / 1000);
    const metadata = {
      hostId,
      projectId,
      threadId,
      parentThreadId: parentThreadIdFromMetadata(thread),
      agentNickname: thread.agentNickname ?? null,
      agentRole: thread.agentRole ?? null,
      title: thread.name,
      name: thread.name,
      preview: thread.preview,
      cwd: thread.cwd,
      status: thread.status,
      recencyAt: toTimestamp(thread.recencyAt ?? thread.updatedAt) ?? timestamp,
      updatedAt: toTimestamp(thread.updatedAt) ?? timestamp,
    };
    const index = gatewayMemoryState.threadMetadata.findIndex(
      (item) => item.hostId === hostId && item.threadId === threadId,
    );
    if (index >= 0) {
      const existing = gatewayMemoryState.threadMetadata[index];
      if (existing === undefined) {
        return;
      }
      gatewayMemoryState.threadMetadata[index] = {
        ...existing,
        ...metadata,
        projectId: projectId ?? existing.projectId,
        parentThreadId: metadata.parentThreadId ?? existing.parentThreadId,
        agentNickname: metadata.agentNickname ?? existing.agentNickname,
        agentRole: metadata.agentRole ?? existing.agentRole,
        cwd: metadata.cwd ?? existing.cwd,
        preview: metadata.preview ?? existing.preview,
        title: metadata.title ?? existing.title,
        name: metadata.name ?? existing.name,
        status: metadata.status,
      };
    } else {
      gatewayMemoryState.threadMetadata.push(metadata);
    }
  },

  list(hostId: number, options: { projectId?: number | null; cwd?: string | null } = {}) {
    return gatewayMemoryState.threadMetadata
      .filter((thread) => {
        if (thread.hostId !== hostId) {
          return false;
        }
        if (options.projectId != null && thread.projectId !== options.projectId) {
          return false;
        }
        if (
          options.cwd !== null &&
          options.cwd !== undefined &&
          thread.cwd !== null &&
          thread.cwd !== options.cwd
        ) {
          return false;
        }
        return true;
      })
      .map((thread) => ({
        id: thread.threadId,
        projectId: thread.projectId,
        parentThreadId: thread.parentThreadId,
        agentNickname: thread.agentNickname,
        agentRole: thread.agentRole,
        title: thread.title,
        name: thread.name,
        preview: thread.preview,
        cwd: thread.cwd,
        status: thread.status,
        recencyAt: thread.recencyAt,
        updatedAt: thread.updatedAt,
      }))
      .sort(
        (left, right) =>
          Number(right.recencyAt ?? right.updatedAt ?? 0) -
          Number(left.recencyAt ?? left.updatedAt ?? 0),
      );
  },
};
