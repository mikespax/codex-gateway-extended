import type { ThreadOpenSnapshot } from "../runtime/types";
import { SERVER_THREAD_CACHE_LIMIT } from "~~/shared/config";
import {
  deletePersistentThreadSnapshot,
  deletePersistentThreadSnapshotsForHost,
  prunePersistentThreadSnapshotsToHosts,
  readPersistentThreadSnapshot,
  writePersistentThreadSnapshot,
} from "../storage/thread-snapshot-cache";
import { currentGatewayUserId, gatewayMemoryState, nowIso } from "./memory";

const persistenceDelayMs = 750;
const pendingPersistence = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; snapshot: ThreadOpenSnapshot }
>();

export const threadSnapshotStore = {
  pruneToHosts(hostIds: Set<number>) {
    gatewayMemoryState.threadSnapshots = gatewayMemoryState.threadSnapshots.filter((record) =>
      hostIds.has(record.hostId),
    );
    const userId = currentGatewayUserId();
    if (userId !== null) {
      cancelPendingOutsideHosts(userId, hostIds);
      prunePersistentThreadSnapshotsToHosts(userId, hostIds);
    }
  },

  deleteForHost(hostId: number) {
    gatewayMemoryState.threadSnapshots = gatewayMemoryState.threadSnapshots.filter(
      (record) => record.hostId !== hostId,
    );
    const userId = currentGatewayUserId();
    if (userId !== null) {
      cancelPendingForHost(userId, hostId);
      deletePersistentThreadSnapshotsForHost(userId, hostId);
    }
  },

  get(hostId: number, threadId: string): ThreadOpenSnapshot | null {
    const record = gatewayMemoryState.threadSnapshots.find(
      (candidate) => candidate.hostId === hostId && candidate.threadId === threadId,
    );
    if (record === undefined) {
      return null;
    }
    record.updatedAt = nowIso();
    return record.snapshot;
  },

  listForHost(hostId: number) {
    return gatewayMemoryState.threadSnapshots
      .filter((record) => record.hostId === hostId)
      .map((record) => ({
        ...record,
        snapshot: record.snapshot,
      }));
  },

  restorePersistent(hostId: number, threadId: string): ThreadOpenSnapshot | null {
    const userId = currentGatewayUserId();
    if (userId === null) return null;
    const record = readPersistentThreadSnapshot(userId, hostId, threadId);
    if (record === null) return null;
    return record.snapshot;
  },

  hydratePersistent(hostId: number, threadId: string, snapshot: ThreadOpenSnapshot) {
    setMemorySnapshot(hostId, threadId, snapshot);
  },

  deletePersistent(hostId: number, threadId: string) {
    const userId = currentGatewayUserId();
    if (userId === null) return;
    cancelPending(userId, hostId, threadId);
    deletePersistentThreadSnapshot(userId, hostId, threadId);
  },

  set(hostId: number, threadId: string, snapshot: ThreadOpenSnapshot) {
    setMemorySnapshot(hostId, threadId, snapshot);
    schedulePersistence(hostId, threadId, snapshot);
  },

  update(
    hostId: number,
    threadId: string,
    updater: (snapshot: ThreadOpenSnapshot | null) => ThreadOpenSnapshot | null,
  ) {
    const nextSnapshot = updater(this.get(hostId, threadId));
    if (nextSnapshot !== null) {
      this.set(hostId, threadId, nextSnapshot);
    }
    return nextSnapshot;
  },
};

function setMemorySnapshot(hostId: number, threadId: string, snapshot: ThreadOpenSnapshot) {
  const updatedAt = nowIso();
  const index = gatewayMemoryState.threadSnapshots.findIndex(
    (record) => record.hostId === hostId && record.threadId === threadId,
  );
  const record = { hostId, threadId, snapshot, updatedAt };
  if (index >= 0) gatewayMemoryState.threadSnapshots[index] = record;
  else gatewayMemoryState.threadSnapshots.push(record);
  pruneOldestSnapshots();
}

function schedulePersistence(hostId: number, threadId: string, snapshot: ThreadOpenSnapshot) {
  const userId = currentGatewayUserId();
  if (userId === null) return;
  const key = persistenceKey(userId, hostId, threadId);
  const pending = pendingPersistence.get(key);
  if (pending !== undefined) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    const latest = pendingPersistence.get(key);
    if (latest === undefined || latest.timer !== timer) return;
    pendingPersistence.delete(key);
    try {
      writePersistentThreadSnapshot(userId, hostId, threadId, latest.snapshot);
    } catch (error) {
      console.warn("[gateway] persistent thread snapshot write failed", {
        userId,
        hostId,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, persistenceDelayMs);
  timer.unref?.();
  pendingPersistence.set(key, { timer, snapshot });
}

function cancelPending(userId: number, hostId: number, threadId: string) {
  const key = persistenceKey(userId, hostId, threadId);
  const pending = pendingPersistence.get(key);
  if (pending !== undefined) clearTimeout(pending.timer);
  pendingPersistence.delete(key);
}

function cancelPendingForHost(userId: number, hostId: number) {
  const prefix = `${userId}:${hostId}:`;
  for (const [key, pending] of pendingPersistence) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(pending.timer);
    pendingPersistence.delete(key);
  }
}

function cancelPendingOutsideHosts(userId: number, hostIds: Set<number>) {
  const prefix = `${userId}:`;
  for (const [key, pending] of pendingPersistence) {
    if (!key.startsWith(prefix)) continue;
    const hostId = Number(key.slice(prefix.length).split(":", 1)[0]);
    if (hostIds.has(hostId)) continue;
    clearTimeout(pending.timer);
    pendingPersistence.delete(key);
  }
}

function persistenceKey(userId: number, hostId: number, threadId: string) {
  return `${userId}:${hostId}:${threadId}`;
}

function pruneOldestSnapshots() {
  const overflow = gatewayMemoryState.threadSnapshots.length - SERVER_THREAD_CACHE_LIMIT;
  if (overflow <= 0) {
    return;
  }
  const evicted = new Set(
    [...gatewayMemoryState.threadSnapshots]
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
      .slice(0, overflow)
      .map((record) => `${record.hostId}:${record.threadId}`),
  );
  gatewayMemoryState.threadSnapshots = gatewayMemoryState.threadSnapshots.filter(
    (record) => !evicted.has(`${record.hostId}:${record.threadId}`),
  );
}
