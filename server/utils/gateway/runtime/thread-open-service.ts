import type { AppServerThread, HostRecord, ThreadRuntimeStatus } from "~~/shared/types";
import { INITIAL_TURN_PAGE_LIMIT } from "~~/shared/config";
import { threadTurnsFromHistory } from "~~/shared/thread-history/shape";
import { projectThreadTimelineHistory } from "~~/shared/thread-history/timeline";
import {
  runtimeStatusFromSnapshotState,
  runtimeStatusFromThreadState,
  runtimeStatusFromTopLevelThreadState,
} from "~~/shared/thread-runtime-status";
import {
  extractThreadSettings,
  latestThreadSettingsFromEvents,
  latestTokenUsageFromEvents,
} from "../protocol/thread-payload";
import { gatewayEventStore } from "../state/gateway-events";
import { projectStore } from "../state/projects";
import { threadMetadataStore } from "../state/thread-metadata";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { ControllerRegistry } from "./controller-registry";
import type { ThreadController } from "./thread-controller";
import { pageCursorState, pageToFullHistory } from "./thread-history-pages";
import { runtimeLog } from "./runtime-log";
import { threadRuntimeEvents } from "./thread-runtime-events";
import { applyEventToOpenSnapshot } from "./open-snapshot-events";
import type { ThreadOpenSnapshot } from "./types";
import { currentGatewayUserId } from "../state/memory";
import {
  parseThreadReadResult,
  parseThreadStartResult,
  parseTurnsPage,
} from "~~/shared/runtime/app-server";
import { gatewayThreadFromAppServer } from "../protocol/gateway-thread";

export class ThreadOpenService {
  private readonly pendingRefreshes = new Map<
    string,
    { limit: number; promise: Promise<ReturnTypeResult> }
  >();

  constructor(private readonly registry: ControllerRegistry) {}

  async openThread(
    host: HostRecord,
    threadId: string,
    projectId: number | null,
    limit = INITIAL_TURN_PAGE_LIMIT,
    activationController?: ThreadController,
    projectCwd?: string | null,
    afterEventId?: number,
  ) {
    const snapshotEventCursor = afterEventId ?? gatewayEventStore.latestId(host.id, threadId);
    const memorySnapshot = threadSnapshotStore.get(host.id, threadId);
    const persistentCandidate =
      memorySnapshot === null
        ? await this.restoreVerifiedPersistentSnapshot(
            host,
            threadId,
            projectId,
            snapshotEventCursor,
          )
        : null;
    const cachedSnapshot = memorySnapshot ?? persistentCandidate?.snapshot ?? null;
    const fallbackRuntimeStatus = persistentCandidate?.authoritativeStatus ?? null;
    const cachedSnapshotEventCursor =
      persistentCandidate?.verified === true
        ? persistentCandidate.lastEventId
        : snapshotEventCursor;
    if (cachedSnapshot) {
      if (
        persistentCandidate?.verified !== false &&
        snapshotSatisfiesTurnLimit(cachedSnapshot, limit)
      ) {
        // Runtime notifications are projected into this snapshot as they arrive, including the
        // active Turn's cumulative output and status. Re-reading a running thread here would make
        // every browser activation call thread/turns/list again. For legacy rollouts app-server
        // must replay the complete JSONL even when the requested page contains only two Turns, so
        // that policy made long conversations slow while their realtime controller was healthy.
        // Only an absent or too-shallow cache requires remote history I/O; reconnect gaps already
        // use the authoritative refresh path explicitly.
        return this.snapshotResult(
          host,
          threadId,
          projectId,
          cachedSnapshot,
          projectCwd,
          undefined,
          cachedSnapshotEventCursor,
        );
      }
      if (persistentCandidate?.verified !== false) {
        runtimeLog("thread cache depth refresh", {
          hostId: host.id,
          threadId,
          cachedTurns: threadTurnsFromHistory(cachedSnapshot.history).length,
          requestedTurns: limit,
        });
      }
    } else {
      runtimeLog("thread cache miss", {
        hostId: host.id,
        threadId,
        limit,
      });
    }

    try {
      return await this.refreshThreadState(
        host,
        threadId,
        projectId,
        limit,
        activationController,
        projectCwd,
        snapshotEventCursor,
      );
    } catch (error) {
      // A transport/RPC failure must not turn a materialized conversation into an empty view.
      // Keep the last durable snapshot as a visible, reconnectable fallback; the next activation
      // will retry the authoritative refresh and replace it when the app-server is reachable.
      if (cachedSnapshot !== null && snapshotSatisfiesTurnLimit(cachedSnapshot, limit)) {
        threadSnapshotStore.hydratePersistent(host.id, threadId, cachedSnapshot);
        runtimeLog("thread cache fallback", {
          hostId: host.id,
          threadId,
          cachedTurns: threadTurnsFromHistory(cachedSnapshot.history).length,
          requestedTurns: limit,
          message: error instanceof Error ? error.message : String(error),
        });
        return this.snapshotResult(
          host,
          threadId,
          projectId,
          cachedSnapshot,
          projectCwd,
          fallbackRuntimeStatus,
          cachedSnapshotEventCursor,
        );
      }
      throw error;
    }
  }

  private async restoreVerifiedPersistentSnapshot(
    host: HostRecord,
    threadId: string,
    projectId: number | null,
    afterEventId: number,
  ): Promise<PersistentThreadSnapshotCandidate | null> {
    const snapshot = threadSnapshotStore.restorePersistent(host.id, threadId);
    if (snapshot === null) return null;
    // Durable snapshots intentionally do not persist a Gateway event cursor. Once this thread
    // has events in the current process, their coverage cannot be proven against the durable
    // snapshot, so an authoritative refresh is safer than advancing past possibly unmaterialized
    // deltas. A post-restart restore starts at cursor zero and can reconcile events emitted during
    // validation normally.
    if (afterEventId > 0) return null;

    let authoritativeThread: AppServerThread;
    try {
      // The in-memory metadata index is intentionally not durable. After a Gateway restart the
      // persistent snapshot must be checked against the app-server's current identity/version
      // before it can be rendered, but a metadata-only read avoids replaying the full history.
      const client = await this.registry.getHostClient(host);
      authoritativeThread = (
        await client.request(
          "thread/read",
          { threadId, includeTurns: false },
          120_000,
          parseThreadReadResult,
        )
      ).thread;
    } catch (error) {
      // Keep the durable entry on transport, timeout, or parse errors. It may still be valid;
      // the normal authoritative refresh below will report the actual failure or recover it.
      runtimeLog("persistent thread cache validation failed", {
        hostId: host.id,
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        snapshot,
        verified: false,
        authoritativeStatus: null,
        lastEventId: afterEventId,
      };
    }

    const status = runtimeStatusFromTopLevelThreadState(authoritativeThread);
    if (
      authoritativeThread.id !== threadId ||
      authoritativeThread.updatedAt !== snapshot.thread.updatedAt ||
      status === "running"
    ) {
      runtimeLog("persistent thread cache rejected", {
        hostId: host.id,
        threadId,
        cachedUpdatedAt: snapshot.thread.updatedAt,
        authoritativeUpdatedAt: authoritativeThread.updatedAt,
        authoritativeStatus: status,
        action: "retained_for_fallback",
      });
      return {
        snapshot,
        verified: false,
        authoritativeStatus: status,
        lastEventId: afterEventId,
      };
    }

    // Seed both volatile indexes from the authoritative metadata. Keep the cached history and
    // cursors, while adopting any newer non-history fields from thread/read (which intentionally
    // omits the turns payload).
    const verifiedSnapshot =
      authoritativeThread === snapshot.thread
        ? snapshot
        : { ...snapshot, thread: authoritativeThread };
    const { snapshot: reconciledSnapshot, lastEventId } = applyEventsAfter(
      host.id,
      threadId,
      verifiedSnapshot,
      afterEventId,
    );
    threadMetadataStore.record(host.id, projectId ?? snapshot.projectId, authoritativeThread);
    threadSnapshotStore.hydratePersistent(host.id, threadId, reconciledSnapshot);
    runtimeLog("persistent thread cache hit", {
      hostId: host.id,
      threadId,
      updatedAt: reconciledSnapshot.thread.updatedAt,
    });
    return {
      snapshot: reconciledSnapshot,
      verified: true,
      authoritativeStatus: status,
      lastEventId,
    };
  }

  startedThreadResult(host: HostRecord, projectId: number | null, rawResult: unknown) {
    const parsed = parseThreadStartResult(rawResult);
    const thread: AppServerThread = parsed.thread;
    const threadId = String(thread.id);
    threadMetadataStore.record(host.id, projectId, thread);
    const recentEvents = gatewayEventStore.list(host.id, threadId, 0, 200);
    const history = projectThreadTimelineHistory({
      thread: { id: thread.id, turns: thread.turns },
    });
    const turnsPage = {
      nextCursor: null,
      backwardsCursor: null,
    };
    const snapshot = {
      thread,
      history,
      projectId,
      turnsPage,
      threadSettings: extractThreadSettings(parsed.raw),
      tokenUsage: latestTokenUsageFromEvents(recentEvents),
    };
    threadSnapshotStore.set(host.id, threadId, snapshot);
    return {
      threadId,
      snapshot,
      result: {
        hostId: host.id,
        thread: gatewayThreadFromAppServer(host.id, projectId, thread),
        history,
        lastEventId: gatewayEventStore.latestId(host.id, threadId),
        runtimeStatus: runtimeStatusFromThreadState(thread, history, recentEvents) ?? "running",
        threadSettings: snapshot.threadSettings,
        tokenUsage: snapshot.tokenUsage,
        projectId,
        project: projectId === null ? null : projectStore.get(projectId),
        turnsPage,
        recentEvents: snapshotRecentEvents(),
      },
    };
  }

  isThreadRunning(hostId: number, threadId: string) {
    const snapshot = threadSnapshotStore.get(hostId, threadId);
    if (snapshot === null) return false;
    const recentEvents = gatewayEventStore.list(hostId, threadId, 0, 200);
    return (
      runtimeStatusFromThreadState(snapshot.thread, snapshot.history, recentEvents) === "running"
    );
  }

  async refreshThreadState(
    host: HostRecord,
    threadId: string,
    projectId: number | null,
    limit = INITIAL_TURN_PAGE_LIMIT,
    activationController?: ThreadController,
    projectCwd?: string | null,
    afterEventId?: number,
  ): Promise<ReturnTypeResult> {
    const key = refreshKey(host.id, threadId);
    const pending = this.pendingRefreshes.get(key);
    if (pending !== undefined) {
      // A wider cold read may reuse an equal/wider in-flight request, but it must never inherit a
      // narrower one. Wait for the narrow refresh to settle, then retry so the server cache
      // monotonically expands to the requested page depth instead of racing two snapshots into the
      // same store entry.
      if (pending.limit >= limit) return pending.promise;
      await pending.promise;
      return this.refreshThreadState(
        host,
        threadId,
        projectId,
        limit,
        activationController,
        projectCwd,
        afterEventId,
      );
    }

    const promise = this.performThreadStateRefresh(
      host,
      threadId,
      projectId,
      limit,
      activationController,
      projectCwd,
      afterEventId ?? gatewayEventStore.latestId(host.id, threadId),
    );
    this.pendingRefreshes.set(key, { limit, promise });
    try {
      return await promise;
    } finally {
      if (this.pendingRefreshes.get(key)?.promise === promise) {
        this.pendingRefreshes.delete(key);
      }
    }
  }

  async refreshThreadRuntimeStatus(host: HostRecord, threadId: string) {
    const snapshotEventCursor = gatewayEventStore.latestId(host.id, threadId);
    const cachedSnapshot = threadSnapshotStore.get(host.id, threadId);
    const client = await this.registry.getHostClient(host);
    const result = await client.request(
      "thread/read",
      { threadId, includeTurns: false },
      120_000,
      parseThreadReadResult,
    );
    threadMetadataStore.record(host.id, null, result.thread);
    let reconciledSnapshot: ThreadOpenSnapshot | null = null;
    if (cachedSnapshot !== null) {
      reconciledSnapshot = applyEventsAfter(
        host.id,
        threadId,
        { ...cachedSnapshot, thread: result.thread },
        snapshotEventCursor,
      ).snapshot;
      threadSnapshotStore.set(host.id, threadId, reconciledSnapshot);
    }
    const status =
      runtimeStatusFromSnapshotState(
        result.thread,
        reconciledSnapshot?.history ?? { thread: { id: threadId, turns: [] } },
      ) ?? "completed";
    threadRuntimeEvents.record(host.id, threadId, "thread/status/changed", {
      method: "thread/status/changed",
      params: { threadId, status },
    });
    return { thread: result.thread, status };
  }

  private async performThreadStateRefresh(
    host: HostRecord,
    threadId: string,
    projectId: number | null,
    limit: number,
    activationController?: ThreadController,
    projectCwd?: string | null,
    afterEventId = gatewayEventStore.latestId(host.id, threadId),
  ) {
    const { snapshot, resolvedProjectId, lastEventId } = await this.loadRemoteOpenSnapshot(
      host,
      threadId,
      projectId,
      limit,
      activationController,
      projectCwd,
      afterEventId,
    );
    const status = runtimeStatusFromSnapshotState(snapshot.thread, snapshot.history) ?? "completed";
    // The refresh event is the backend's canonical correction after reconnect
    // or stale running scans; clients must converge on this status.
    threadRuntimeEvents.record(host.id, threadId, "thread/status/changed", {
      method: "thread/status/changed",
      params: {
        threadId,
        status,
      },
    });
    const recentEvents = gatewayEventStore.list(host.id, threadId, 0, 200);
    return {
      thread: gatewayThreadFromAppServer(host.id, resolvedProjectId, snapshot.thread),
      history: snapshot.history,
      lastEventId,
      runtimeStatus: runtimeStatusFromThreadState(snapshot.thread, snapshot.history, recentEvents),
      projectId: resolvedProjectId,
      project: resolvedProjectId === null ? null : projectStore.get(resolvedProjectId),
      turnsPage: snapshot.turnsPage,
      threadSettings: snapshot.threadSettings,
      tokenUsage: latestTokenUsageFromEvents(recentEvents) ?? snapshot.tokenUsage,
      recentEvents: snapshotRecentEvents(),
    };
  }

  private snapshotResult(
    host: HostRecord,
    threadId: string,
    projectId: number | null,
    snapshot: ThreadOpenSnapshot,
    projectCwd?: string | null,
    runtimeStatusOverride?: ThreadRuntimeStatus | null,
    lastEventId = gatewayEventStore.latestId(host.id, threadId),
  ) {
    const recentEvents = gatewayEventStore.list(host.id, threadId, 0, 200);
    const resolvedProjectId = resolveProjectId(
      host.id,
      projectId ?? snapshot.projectId,
      snapshot.thread.cwd,
      projectCwd,
    );
    runtimeLog("thread cache hit", {
      hostId: host.id,
      threadId,
      projectId: resolvedProjectId,
    });
    return {
      thread: gatewayThreadFromAppServer(host.id, resolvedProjectId, snapshot.thread),
      history: snapshot.history,
      lastEventId,
      runtimeStatus:
        runtimeStatusOverride ??
        runtimeStatusFromThreadState(snapshot.thread, snapshot.history, recentEvents),
      projectId: resolvedProjectId,
      project: resolvedProjectId === null ? null : projectStore.get(resolvedProjectId),
      turnsPage: snapshot.turnsPage,
      threadSettings: snapshot.threadSettings,
      tokenUsage: latestTokenUsageFromEvents(recentEvents) ?? snapshot.tokenUsage,
      recentEvents: snapshotRecentEvents(),
    };
  }

  private async loadRemoteOpenSnapshot(
    host: HostRecord,
    threadId: string,
    projectId: number | null,
    limit: number,
    activationController?: ThreadController,
    projectCwd?: string | null,
    afterEventId = gatewayEventStore.latestId(host.id, threadId),
  ) {
    if (activationController !== undefined) {
      const resumed = await activationController.resumeWithInitialTurnsPage(limit);
      const initialTurnsPage = resumed.initialTurnsPage;
      if (initialTurnsPage === null || initialTurnsPage === undefined) {
        throw new Error("thread/resume omitted the requested initialTurnsPage");
      }
      return this.storeRemoteOpenSnapshot(
        host,
        projectId,
        resumed.thread,
        initialTurnsPage,
        extractThreadSettings(resumed),
        activationController,
        projectCwd,
        afterEventId,
      );
    }

    // Non-browser refreshes, such as reconciliation after a failed turn command, already run under
    // a controller operation and must not acquire another subscription lease. They retain the
    // metadata + page pair; normal browser cold opens use the combined resume path above.
    const client = await this.registry.getHostClient(host);
    const [read, initialTurnsPage] = await Promise.all([
      client.request(
        "thread/read",
        { threadId, includeTurns: false },
        120_000,
        parseThreadReadResult,
      ),
      client.request(
        "thread/turns/list",
        {
          threadId,
          cursor: null,
          limit,
          sortDirection: "desc",
          itemsView: "full",
        },
        120_000,
        parseTurnsPage,
      ),
    ]);
    return this.storeRemoteOpenSnapshot(
      host,
      projectId,
      read.thread,
      initialTurnsPage,
      latestThreadSettingsFromEvents(gatewayEventStore.list(host.id, threadId, 0, 200)),
      undefined,
      projectCwd,
      afterEventId,
    );
  }

  private storeRemoteOpenSnapshot(
    host: HostRecord,
    projectId: number | null,
    thread: AppServerThread,
    initialTurnsPage: ReturnType<typeof parseTurnsPage>,
    threadSettings: ReturnType<typeof extractThreadSettings> | null,
    activationController?: ThreadController,
    projectCwd?: string | null,
    afterEventId = gatewayEventStore.latestId(host.id, thread.id),
  ) {
    const threadId = thread.id;
    const resolvedProjectId = resolveProjectId(host.id, projectId, thread.cwd, projectCwd);
    threadMetadataStore.record(host.id, resolvedProjectId, thread);

    const recentEvents = gatewayEventStore.list(host.id, threadId, 0, 200);
    // thread/resume does not expose collaborationMode. Preserve the latest complete official
    // thread/settings/updated projection when one exists; otherwise the resume DTO still supplies
    // model and effort for threads that have never changed settings during this Gateway lifetime.
    const effectiveThreadSettings = latestThreadSettingsFromEvents(recentEvents) ?? threadSettings;
    const { snapshot, lastEventId } = applyEventsAfter(
      host.id,
      threadId,
      {
        thread,
        history: projectThreadTimelineHistory(pageToFullHistory(thread, initialTurnsPage)),
        projectId: resolvedProjectId,
        turnsPage: pageCursorState(initialTurnsPage),
        threadSettings: effectiveThreadSettings,
        tokenUsage: latestTokenUsageFromEvents(recentEvents),
      },
      afterEventId,
    );
    // During browser activation the controller is created before the cold snapshot exists. Route
    // the write through it so sub-agent classification and active-main-thread handoff state are
    // initialized together with the cache. Non-browser reconciliation has no activation controller
    // and writes the same canonical snapshot directly.
    if (activationController === undefined) threadSnapshotStore.set(host.id, threadId, snapshot);
    else activationController.setOpenSnapshot(snapshot);
    return { snapshot, resolvedProjectId, lastEventId };
  }
}

type ReturnTypeResult = Awaited<ReturnType<ThreadOpenService["performThreadStateRefresh"]>>;

interface PersistentThreadSnapshotCandidate {
  snapshot: ThreadOpenSnapshot;
  verified: boolean;
  authoritativeStatus: ThreadRuntimeStatus | null;
  lastEventId: number;
}

function snapshotSatisfiesTurnLimit(snapshot: ThreadOpenSnapshot, limit: number) {
  // A cache wider than the caller's first-page preference is still a valid hit. Truncating it
  // would require a different app-server cursor at the new oldest row, and cursors are deliberately
  // opaque; refreshing merely to shrink a valid cache would add SSH/RPC latency. New pages start at
  // INITIAL_TURN_PAGE_LIMIT, while same-page Pinia views ask for the depth they already retained.
  return (
    threadTurnsFromHistory(snapshot.history).length >= limit ||
    snapshot.turnsPage.nextCursor === null
  );
}

function refreshKey(hostId: number, threadId: string) {
  const userId = currentGatewayUserId();
  if (userId === null) {
    throw new Error("Thread refresh requires an authenticated user scope");
  }
  return `${userId}:${hostId}:${threadId}`;
}

function resolveProjectId(
  hostId: number,
  projectId: number | null,
  cwd: unknown,
  projectCwd?: string | null,
) {
  const requestedPath = normalizedPath(projectCwd);
  if (requestedPath !== null) {
    const requested = projectStore
      .list(hostId)
      .find((project) => project.remotePath === requestedPath);
    if (requested !== undefined) return requested.id;
  }
  const selected = projectId === null ? null : projectStore.get(projectId);
  if (requestedPath === null && selected?.hostId === hostId) return selected.id;
  if (typeof cwd !== "string" || cwd.trim() === "") return null;
  return projectStore.ensureForPath(hostId, cwd).id;
}

function normalizedPath(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function snapshotRecentEvents() {
  // Open results already include materialized history plus lastEventId. Re-sending recent
  // app-server events here duplicates large cumulative diff/output payloads and can push mobile
  // browsers over their renderer memory limit before the realtime subscription starts. New live
  // events are replayed through thread.event after lastEventId, so the snapshot path intentionally
  // keeps this legacy field empty while runtime status/token usage are computed server-side above.
  return [];
}

function applyEventsAfter(
  hostId: number,
  threadId: string,
  snapshot: ThreadOpenSnapshot,
  afterEventId: number,
) {
  // If the captured cursor predates the retained event window, do not advance the snapshot
  // cursor to the newest retained event. The caller will subscribe from the original cursor and
  // receive thread.events.gap, which owns authoritative recovery instead of silently skipping
  // events that were pruned while the remote snapshot was loading.
  if (gatewayEventStore.hasReplayGap(hostId, threadId, afterEventId)) {
    return { snapshot, lastEventId: afterEventId };
  }
  let reconciled = snapshot;
  const events = gatewayEventStore.list(hostId, threadId, afterEventId, 500);
  for (const event of events) {
    reconciled =
      applyEventToOpenSnapshot(reconciled, event.method, event.payload, event.createdAt) ??
      reconciled;
  }
  return { snapshot: reconciled, lastEventId: events.at(-1)?.id ?? afterEventId };
}
