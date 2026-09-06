import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  CLIENT_THREAD_CACHE_LIMIT,
  PERSISTENT_THREAD_CACHE_TTL_MS,
  PERSISTENT_THREAD_VIEW_MAX_BYTES,
} from "~~/shared/config";
import type { GatewayThread, ThreadHistoryState } from "~~/shared/types";
import { projectThreadTimelineHistory } from "~~/shared/thread-history/timeline";
import { useAuthStore } from "@/stores/auth";
import type { ThreadViewState } from "../types";

interface PersistedThreadView {
  hostId: number;
  projectId: number | null;
  threadId: string;
  currentThread: GatewayThread;
  history: ThreadHistoryState;
  olderTurnsCursor: string | null;
  newerTurnsCursor: string | null;
  lastEventId: number;
  eventEpoch: string;
}

interface PersistentThreadViewRecord {
  key: string;
  account: string;
  hostId: number;
  threadId: string;
  view: PersistedThreadView;
  byteSize: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
}

interface ThreadViewCacheDatabase extends DBSchema {
  threadViews: {
    key: string;
    value: PersistentThreadViewRecord;
    indexes: { "by-account": string };
  };
}

const databaseName = "codex-gateway-thread-view-cache";
const databaseVersion = 1;
const writeDelayMs = 500;
let databasePromise: Promise<IDBPDatabase<ThreadViewCacheDatabase>> | null = null;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

export async function readPersistentThreadView(hostId: number, threadId: string) {
  if (!import.meta.client) return null;
  const account = currentAccount();
  if (account === null) return null;
  const key = cacheKey(account, hostId, threadId);
  try {
    const database = await threadViewDatabase();
    // Read and touch the record in one transaction. A separate get followed by put can
    // overwrite a newer snapshot written while the IndexedDB request was in flight; returning
    // that stale view would then schedule another stale write during thread restoration.
    const transaction = database.transaction("threadViews", "readwrite");
    const record = await transaction.store.get(key);
    if (record === undefined) {
      await transaction.done;
      return null;
    }
    if (record.expiresAt <= Date.now() || !isValidRecord(record, account, hostId, threadId)) {
      await transaction.store.delete(key);
      await transaction.done;
      return null;
    }
    record.lastAccessedAt = Date.now();
    await transaction.store.put(record);
    await transaction.done;
    return hydratedThreadView(record.view);
  } catch (error) {
    warnCacheFailure("read", error);
    return null;
  }
}

export function persistThreadViewSoon(view: ThreadViewState) {
  if (!import.meta.client || view.currentThread === null || view.history === null) return;
  const account = currentAccount();
  if (account === null) return;
  const persisted = serializableView(view);
  const serialized = JSON.stringify(persisted);
  const byteSize = new TextEncoder().encode(serialized).byteLength;
  if (byteSize > PERSISTENT_THREAD_VIEW_MAX_BYTES) return;

  const key = cacheKey(account, view.hostId, view.threadId);
  const pending = pendingWrites.get(key);
  if (pending !== undefined) clearTimeout(pending);
  const timer = setTimeout(() => {
    if (pendingWrites.get(key) !== timer) return;
    pendingWrites.delete(key);
    void writePersistentThreadView({
      key,
      account,
      hostId: view.hostId,
      threadId: view.threadId,
      view: persisted,
      byteSize,
      updatedAt: Date.now(),
      lastAccessedAt: Date.now(),
      expiresAt: Date.now() + PERSISTENT_THREAD_CACHE_TTL_MS,
    });
  }, writeDelayMs);
  pendingWrites.set(key, timer);
}

async function writePersistentThreadView(record: PersistentThreadViewRecord) {
  try {
    const database = await threadViewDatabase();
    const transaction = database.transaction("threadViews", "readwrite");
    await transaction.store.put(record);
    const records = await transaction.store.index("by-account").getAll(record.account);
    const now = Date.now();
    const retained = records
      .filter((candidate) => candidate.expiresAt > now)
      .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
      .slice(0, CLIENT_THREAD_CACHE_LIMIT);
    const retainedKeys = new Set(retained.map((candidate) => candidate.key));
    await Promise.all([
      ...records
        .filter((candidate) => !retainedKeys.has(candidate.key))
        .map((candidate) => transaction.store.delete(candidate.key)),
      transaction.done,
    ]);
  } catch (error) {
    warnCacheFailure("write", error);
  }
}

function threadViewDatabase() {
  databasePromise ??= openDB<ThreadViewCacheDatabase>(databaseName, databaseVersion, {
    upgrade(database) {
      const store = database.createObjectStore("threadViews", { keyPath: "key" });
      store.createIndex("by-account", "account");
    },
  });
  return databasePromise;
}

function currentAccount() {
  const account = useAuthStore().username.trim();
  return account === "" ? null : account;
}

function cacheKey(account: string, hostId: number, threadId: string) {
  return JSON.stringify([account, hostId, threadId]);
}

function serializableView(view: ThreadViewState): PersistedThreadView {
  if (view.currentThread === null || view.history === null) {
    throw new Error("Only materialized thread views can be persisted");
  }
  return {
    hostId: view.hostId,
    projectId: view.projectId,
    threadId: view.threadId,
    currentThread: view.currentThread,
    history: view.history,
    olderTurnsCursor: view.olderTurnsCursor,
    newerTurnsCursor: view.newerTurnsCursor,
    lastEventId: view.lastEventId,
    eventEpoch: view.eventEpoch,
  };
}

function hydratedThreadView(view: PersistedThreadView): ThreadViewState {
  const history = projectThreadTimelineHistory(view.history);
  return {
    ...view,
    history,
    timelineTurns: history.thread.turns,
    events: [],
    loading: false,
    error: null,
  };
}

function isValidRecord(
  record: PersistentThreadViewRecord,
  account: string,
  hostId: number,
  threadId: string,
) {
  const view = record.view;
  return (
    record.account === account &&
    record.hostId === hostId &&
    record.threadId === threadId &&
    view.hostId === hostId &&
    view.threadId === threadId &&
    view.currentThread?.id === threadId &&
    view.history?.thread?.id === threadId &&
    Array.isArray(view.history.thread.turns) &&
    Number.isInteger(view.lastEventId) &&
    view.lastEventId >= 0 &&
    typeof view.eventEpoch === "string"
  );
}

function warnCacheFailure(operation: "read" | "write", error: unknown) {
  console.warn(`[gateway] IndexedDB thread cache ${operation} failed`, {
    error: error instanceof Error ? error.message : String(error),
  });
}
