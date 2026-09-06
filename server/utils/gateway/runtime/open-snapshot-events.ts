import { SERVER_TURN_CACHE_LIMIT } from "~~/shared/config";
import { applyAppServerEventToHistory } from "~~/shared/thread-history/app-server-events";
import { projectThreadTimelineHistory } from "~~/shared/thread-history/timeline";
import { normalizeTokenUsage } from "~~/shared/token-usage";
import type { RpcEnvelope, ThreadHistoryState, ThreadTimelineHistoryState } from "~~/shared/types";
import {
  appServerThreadStatusFromUnknown,
  threadSettingsFromAppServer,
} from "~~/shared/runtime/app-server";
import { idFromUnknown, recordFromUnknown } from "~~/shared/utils/records";
import type { ThreadOpenSnapshot } from "./types";

type SnapshotEventReducer = (
  snapshot: ThreadOpenSnapshot,
  params: Record<string, unknown>,
) => ThreadOpenSnapshot;

const snapshotEventReducers: Record<string, SnapshotEventReducer> = {
  "thread/status/changed": (snapshot, params) =>
    updateSnapshotThreadStatus(snapshot, params.status),
  "thread/settings/updated": updateSnapshotThreadSettings,
  "thread/tokenUsage/updated": (snapshot, params) => ({
    ...snapshot,
    tokenUsage: normalizeTokenUsage(params.tokenUsage) ?? snapshot.tokenUsage,
  }),
};

export function applyEventToOpenSnapshot(
  snapshot: ThreadOpenSnapshot | null,
  method: string,
  payload: RpcEnvelope,
  createdAt?: string | null,
) {
  if (snapshot === null) {
    return snapshot;
  }

  const params = eventParams(payload.params);
  const eventThreadId =
    idFromUnknown(params.threadId) ?? idFromUnknown(snapshotThread(snapshot).id);
  const reducedHistory = applyAppServerEventToHistory({
    history: snapshot.history,
    currentThread: snapshot.thread,
    threadId: eventThreadId === null ? "" : String(eventThreadId),
    method,
    payload: { id: payload.id, params },
    createdAt,
  });
  // Snapshot history is the backend's materialized timeline cache. Re-project only after an
  // app-server event changed that data; ordinary thread opens then return this cached value without
  // rescanning every item on either side of the transport.
  const history = projectThreadTimelineHistory(
    trimSnapshotHistory(reducedHistory ?? snapshot.history),
  );
  let nextSnapshot = withSnapshotHistory(snapshot, history);
  nextSnapshot = snapshotEventReducers[method]?.(nextSnapshot, params) ?? nextSnapshot;
  return nextSnapshot;
}

function eventParams(value: unknown): Record<string, unknown> {
  return recordFromUnknown(value) ?? {};
}

function trimSnapshotHistory(history: ThreadHistoryState): ThreadHistoryState {
  return {
    ...history,
    thread: {
      ...history.thread,
      turns: history.thread.turns.slice(-SERVER_TURN_CACHE_LIMIT),
    },
  };
}

function updateSnapshotThreadStatus(snapshot: ThreadOpenSnapshot, status: unknown) {
  const value = appServerThreadStatusFromUnknown(status);
  if (value === null) {
    return snapshot;
  }
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      status: value,
    },
  };
}

function withSnapshotHistory(
  snapshot: ThreadOpenSnapshot,
  history: ThreadTimelineHistoryState,
): ThreadOpenSnapshot {
  return {
    ...snapshot,
    history,
  };
}

function snapshotThread(snapshot: ThreadOpenSnapshot) {
  return snapshot.history.thread;
}

function updateSnapshotThreadSettings(
  snapshot: ThreadOpenSnapshot,
  params: Record<string, unknown>,
) {
  const threadSettings = threadSettingsFromAppServer(params.threadSettings);
  return threadSettings === null ? snapshot : { ...snapshot, threadSettings };
}
