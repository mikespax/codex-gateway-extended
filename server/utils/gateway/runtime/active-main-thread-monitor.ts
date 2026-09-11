import pLimit from "p-limit";
import type { AppServerThread, HostRecord } from "~~/shared/types";
import {
  appServerThreadFromUnknown,
  isAppServerSubAgentThread,
  parseLoadedThreadsPage,
  parseThreadListPage,
  type AppServerThreadListPage,
  type LoadedThreadsPage,
} from "~~/shared/runtime/app-server";
import { recordFromUnknown } from "~~/shared/utils/records";
import { threadIdFromNotification } from "../protocol/thread-payload";
import { currentGatewayUserId, gatewayMemoryState } from "../state/memory";
import type { CodexRpcClient } from "../infra/rpc/rpc";
import { runtimeLog } from "./runtime-log";
import {
  isThreadActiveStatus,
  runtimeStatusFromAppThreadStatus,
} from "~~/shared/thread-runtime-status";
import { threadMetadataStore } from "../state/thread-metadata";
import { threadRuntimeEvents } from "./thread-runtime-events";

const RECOVERY_CONCURRENCY = 2;
const RECOVERY_TIMEOUT_MS = 15_000;
const UNSUBSCRIBE_TIMEOUT_MS = 5_000;
const MISSING_ROLLOUT_COOLDOWN_MS = 5 * 60_000;
const MONITOR_RELEASE_GRACE_MS = 90_000;

type ControllerLookup = (threadId: string) => boolean;

interface MonitorContext {
  host: HostRecord;
  client: CodexRpcClient;
  hasController: ControllerLookup;
}

/**
 * Attaches Gateway to main threads created by another app-server client, such as
 * VS Code. `thread/started` is broadcast by app-server to every connection, while
 * turn events are delivered only after this connection resumes that specific thread.
 *
 * Do not poll `thread/loaded/list` here. It exposes only ids, so the old monitor
 * followed every poll with `thread/read` for every loaded thread and then resumed
 * active ones. That work shared the only Host RPC connection with foreground UI
 * requests and could make a normal realtime request time out. Recovery scans once
 * after a Host connection is established, solely to cover a turn that was already
 * running while Gateway was disconnected.
 */
class ActiveMainThreadMonitor {
  private readonly observedByHost = new Map<string, Set<string>>();
  private readonly pendingByThread = new Map<string, Promise<void>>();
  private readonly pendingRecoveries = new Map<string, Promise<void>>();
  private readonly pendingPinnedRecoveries = new Map<string, Promise<void>>();
  private readonly pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unavailableUntil = new Map<string, number>();
  private readonly generations = new Map<string, number>();

  async recoverHost(context: MonitorContext) {
    const hostKey = this.hostKey(context.host.id);
    const pending = this.pendingRecoveries.get(hostKey);
    if (pending) return pending;

    const generation = this.generation(hostKey);
    const recovery = this.recoverLoadedThreads(context, hostKey, generation)
      .catch((error) => {
        // Observation is additive. A recovery failure must not make a connected
        // Host unavailable or surface as a browser realtime request failure.
        runtimeLog("active main thread recovery failed", {
          hostId: context.host.id,
          hostName: context.host.name,
          message: messageFromError(error),
        });
      })
      .finally(() => {
        if (this.pendingRecoveries.get(hostKey) === recovery) {
          this.pendingRecoveries.delete(hostKey);
        }
      });
    this.pendingRecoveries.set(hostKey, recovery);
    return recovery;
  }

  /**
   * Pinned threads are the user's live sidebar contract. They may not appear in
   * `thread/loaded/list` when their app-server client started them before Gateway connected, so
   * probe only this small explicit set and subscribe only to threads whose metadata is active.
   */
  async recoverPinnedThreads(context: MonitorContext) {
    const hostKey = this.hostKey(context.host.id);
    const pending = this.pendingPinnedRecoveries.get(hostKey);
    if (pending !== undefined) return pending;

    const generation = this.generation(hostKey);
    const recovery = this.recoverConfiguredPinnedThreads(context, hostKey, generation)
      .catch((error) => {
        runtimeLog("pinned thread recovery failed", {
          hostId: context.host.id,
          hostName: context.host.name,
          message: messageFromError(error),
        });
      })
      .finally(() => {
        if (this.pendingPinnedRecoveries.get(hostKey) === recovery) {
          this.pendingPinnedRecoveries.delete(hostKey);
        }
      });
    this.pendingPinnedRecoveries.set(hostKey, recovery);
    return recovery;
  }

  handleNotification(context: MonitorContext, message: unknown) {
    const method = recordFromUnknown(message)?.method;
    const threadId = threadIdFromNotification(message);
    if (threadId === null) return;

    if (method === "thread/started") {
      this.cancelPendingRelease(this.hostKey(context.host.id), threadId);
      this.clearUnavailable(context.host.id, threadId);
      const thread = startedThread(message);
      if (thread !== null) threadMetadataStore.record(context.host.id, null, thread);
      // `thread/started` also announces newly-created idle threads. Resuming every announcement
      // would materialize conversations that no Gateway browser is using. Status broadcasts cover
      // later turns, so only an already-active main thread is eligible for monitor ownership here.
      if (thread === null || isAppServerSubAgentThread(thread) || !isActive(thread)) return;
      this.scheduleObservation(context, threadId, "active main thread subscribe failed");
      return;
    }

    if (method === "thread/status/changed") {
      const params = recordFromUnknown(recordFromUnknown(message)?.params);
      if (runtimeStatusFromAppThreadStatus(params?.status) === "running") {
        this.cancelPendingRelease(this.hostKey(context.host.id), threadId);
        // Existing idle threads do not emit thread/started for every new turn. The global status
        // broadcast is therefore the ownership signal for work started by VS Code and other
        // app-server clients; resume validates main-vs-subagent before retaining the subscription.
        this.scheduleObservation(context, threadId, "active main thread status subscribe failed");
      } else {
        // App-server status broadcasts can briefly report a non-running state while a turn is
        // waiting for a client/approval or while persistence catches up. Keep the monitor lease
        // through that transition; a later active event cancels the release. A genuinely idle
        // thread is still unsubscribed after the bounded grace period.
        this.scheduleRelease(context, threadId);
      }
      return;
    }

    // Do not release on turn/completed. App-server finalizes persistence before broadcasting the
    // subsequent non-active thread/status/changed event; unsubscribing in between can miss the
    // remaining persistence/Goal notifications. The status event is the ownership edge.
  }

  adoptSubscribedThread(context: MonitorContext, threadId: string) {
    const hostKey = this.hostKey(context.host.id);
    let observed = this.observedByHost.get(hostKey);
    if (observed === undefined) {
      observed = new Set();
      this.observedByHost.set(hostKey, observed);
    }
    if (observed.has(threadId)) return;
    // ControllerRegistry calls this synchronously before removing the final browser-owned
    // controller. The app-server subscription is already live, so resuming here would duplicate
    // work on the Host's single RPC channel; recording ownership is the complete handoff.
    observed.add(threadId);
    runtimeLog("adopted active main thread subscription", {
      hostId: context.host.id,
      hostName: context.host.name,
      threadId,
    });
  }

  observeKnownActiveThread(context: MonitorContext, threadId: string) {
    return this.observeThread(context, threadId);
  }

  hasObservedThread(hostId: number, threadId: string) {
    return this.observedByHost.get(this.hostKey(hostId))?.has(threadId) === true;
  }

  observedCount(hostId: number, userId = requiredUserId()) {
    return this.observedByHost.get(this.hostKey(hostId, userId))?.size ?? 0;
  }

  reclaimSubscribedThread(hostId: number, threadId: string) {
    const hostKey = this.hostKey(hostId);
    const observed = this.observedByHost.get(hostKey);
    if (observed?.delete(threadId) !== true) return false;
    if (observed.size === 0) this.observedByHost.delete(hostKey);
    // The new controller inherits the already-live subscription. Do not unsubscribe or resume:
    // both operations create an avoidable delivery gap/duplicate on the shared Host RPC channel.
    return true;
  }

  forgetHost(userId: number, hostId: number) {
    const key = this.hostKey(hostId, userId);
    const threadPrefix = `${key}:`;
    this.generations.set(key, this.generation(key) + 1);
    this.observedByHost.delete(key);
    this.pendingRecoveries.delete(key);
    this.pendingPinnedRecoveries.delete(key);
    for (const key of this.pendingByThread.keys()) {
      if (key.startsWith(threadPrefix)) {
        this.pendingByThread.delete(key);
      }
    }
    for (const key of this.unavailableUntil.keys()) {
      if (key.startsWith(threadPrefix)) this.unavailableUntil.delete(key);
    }
    for (const [pendingKey, timer] of this.pendingReleases) {
      if (pendingKey.startsWith(threadPrefix)) {
        clearTimeout(timer);
        this.pendingReleases.delete(pendingKey);
      }
    }
  }

  private async recoverLoadedThreads(context: MonitorContext, hostKey: string, generation: number) {
    const threads = await activeLoadedMainThreads(context.client);
    const limit = pLimit(RECOVERY_CONCURRENCY);
    await Promise.all(
      threads.map((thread) =>
        limit(async () => {
          if (!this.isCurrent(hostKey, generation)) return;
          await this.observeThread(context, thread.id);
        }),
      ),
    );
  }

  private async recoverConfiguredPinnedThreads(
    context: MonitorContext,
    hostKey: string,
    generation: number,
  ) {
    const threadIds = pinnedThreadIdsForHost(context.host.id);
    if (threadIds.length === 0) return;
    const limit = pLimit(RECOVERY_CONCURRENCY);
    await Promise.all(
      threadIds.map((threadId) =>
        limit(async () => {
          if (!this.isCurrent(hostKey, generation)) return;
          await this.probePinnedThread(context, threadId, hostKey, generation);
        }),
      ),
    );
  }

  private async probePinnedThread(
    context: MonitorContext,
    threadId: string,
    hostKey: string,
    generation: number,
  ) {
    if (context.hasController(threadId) || this.hasObservedThread(context.host.id, threadId))
      return;
    try {
      const result = await context.client.request(
        "thread/read",
        { threadId, includeTurns: false },
        RECOVERY_TIMEOUT_MS,
      );
      const resultRecord = recordFromUnknown(result);
      const thread = appServerThreadFromUnknown(resultRecord?.thread ?? result);
      if (!this.isCurrent(hostKey, generation) || thread === null) return;
      if (isAppServerSubAgentThread(thread)) return;
      threadMetadataStore.record(context.host.id, null, thread);
      const status = runtimeStatusFromAppThreadStatus(thread.status);
      // Publish the probe result immediately so the sidebar converges even when the upstream
      // resume response does not repeat a status event.
      threadRuntimeEvents.record(context.host.id, threadId, "thread/status/changed", {
        method: "thread/status/changed",
        params: { threadId, status: thread.status },
      });
      if (status === "running") {
        await this.observeThread(context, threadId);
      }
    } catch (error) {
      if (isMissingRolloutError(error)) this.suppressUnavailable(hostKey, threadId);
      runtimeLog("pinned thread status probe failed", {
        hostId: context.host.id,
        hostName: context.host.name,
        threadId,
        message: messageFromError(error),
      });
    }
  }

  private async observeThread(context: MonitorContext, threadId: string) {
    if (context.hasController(threadId)) return;
    const hostKey = this.hostKey(context.host.id);
    this.cancelPendingRelease(hostKey, threadId);
    if (this.isUnavailable(hostKey, threadId)) return;
    const observed = this.observedByHost.get(hostKey);
    if (observed?.has(threadId) === true) return;

    const key = `${hostKey}:${threadId}`;
    const pending = this.pendingByThread.get(key);
    if (pending !== undefined) return pending;

    const generation = this.generation(hostKey);
    const subscription = this.resumeMonitorOnlyThread(context, threadId, generation).finally(() => {
      if (this.pendingByThread.get(key) === subscription) {
        this.pendingByThread.delete(key);
      }
    });
    this.pendingByThread.set(key, subscription);
    return subscription;
  }

  private scheduleObservation(context: MonitorContext, threadId: string, failureMessage: string) {
    // The Host session first routes a global notification to this monitor and then records it in
    // threadRuntimeEvents for browser peers. Deferring one microtask lets a browser's event
    // listener acquire its explicit lease first; otherwise both paths can issue thread/resume for
    // the same active thread on the shared RPC connection.
    queueMicrotask(() => {
      void this.observeThread(context, threadId).catch((error) => {
        runtimeLog(failureMessage, {
          hostId: context.host.id,
          hostName: context.host.name,
          threadId,
          message: messageFromError(error),
        });
      });
    });
  }

  private async resumeMonitorOnlyThread(
    context: MonitorContext,
    threadId: string,
    generation: number,
  ) {
    const hostKey = this.hostKey(context.host.id);
    let result: unknown;
    try {
      result = await context.client.request(
        "thread/resume",
        { threadId, excludeTurns: true },
        RECOVERY_TIMEOUT_MS,
      );
    } catch (error) {
      if (isMissingRolloutError(error)) this.suppressUnavailable(hostKey, threadId);
      throw error;
    }
    const resultRecord = recordFromUnknown(result);
    const thread = appServerThreadFromUnknown(resultRecord?.thread ?? result);
    if (!this.isCurrent(hostKey, generation) || context.hasController(threadId)) return;

    if (thread === null || isAppServerSubAgentThread(thread) || !isActive(thread)) {
      await this.unsubscribe(context, threadId);
      return;
    }

    this.adoptSubscribedThread(context, threadId);
    runtimeLog("subscribed to active main thread", {
      hostId: context.host.id,
      hostName: context.host.name,
      threadId,
    });
  }

  private async releaseThread(context: MonitorContext, threadId: string) {
    const hostKey = this.hostKey(context.host.id);
    const observed = this.observedByHost.get(hostKey);
    if (observed?.delete(threadId) !== true) return;
    if (observed.size === 0) this.observedByHost.delete(hostKey);
    if (!context.hasController(threadId)) {
      await this.unsubscribe(context, threadId);
    }
  }

  private scheduleRelease(context: MonitorContext, threadId: string) {
    const hostKey = this.hostKey(context.host.id);
    const key = `${hostKey}:${threadId}`;
    if (this.pendingReleases.has(key)) return;
    const timer = setTimeout(() => {
      if (this.pendingReleases.get(key) !== timer) return;
      this.pendingReleases.delete(key);
      void this.releaseThread(context, threadId);
    }, MONITOR_RELEASE_GRACE_MS);
    this.pendingReleases.set(key, timer);
  }

  private cancelPendingRelease(hostKey: string, threadId: string) {
    const key = `${hostKey}:${threadId}`;
    const timer = this.pendingReleases.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pendingReleases.delete(key);
  }

  private async unsubscribe(context: MonitorContext, threadId: string) {
    await context.client
      .request("thread/unsubscribe", { threadId }, UNSUBSCRIBE_TIMEOUT_MS)
      .catch((error) => {
        runtimeLog("monitor-only thread unsubscribe failed", {
          hostId: context.host.id,
          hostName: context.host.name,
          threadId,
          message: messageFromError(error),
        });
      });
  }

  private hostKey(hostId: number, userId = requiredUserId()) {
    return `${userId}:${hostId}`;
  }

  private generation(key: string) {
    return this.generations.get(key) ?? 0;
  }

  private isCurrent(key: string, generation: number) {
    return this.generation(key) === generation;
  }

  private unavailableKey(hostKey: string, threadId: string) {
    return `${hostKey}:${threadId}`;
  }

  private isUnavailable(hostKey: string, threadId: string) {
    const key = this.unavailableKey(hostKey, threadId);
    const until = this.unavailableUntil.get(key);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.unavailableUntil.delete(key);
    return false;
  }

  private suppressUnavailable(hostKey: string, threadId: string) {
    this.unavailableUntil.set(
      this.unavailableKey(hostKey, threadId),
      Date.now() + MISSING_ROLLOUT_COOLDOWN_MS,
    );
  }

  private clearUnavailable(hostId: number, threadId: string) {
    this.unavailableUntil.delete(this.unavailableKey(this.hostKey(hostId), threadId));
  }
}

function pinnedThreadIdsForHost(hostId: number) {
  return [
    ...new Set(
      gatewayMemoryState.pinnedThreads
        .filter((thread) => thread.hostId === hostId && thread.threadId.trim() !== "")
        .map((thread) => thread.threadId.trim()),
    ),
  ];
}

async function loadedThreadIds(client: CodexRpcClient) {
  const threadIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: LoadedThreadsPage = await client.request(
      "thread/loaded/list",
      { cursor, limit: 100 },
      RECOVERY_TIMEOUT_MS,
      parseLoadedThreadsPage,
    );
    for (const threadId of page.data) {
      if (threadId.trim() !== "") threadIds.add(threadId);
    }
    const nextCursor: string | null = page.nextCursor ?? null;
    if (nextCursor === null || nextCursor === "" || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor !== null);
  return threadIds;
}

async function activeLoadedMainThreads(client: CodexRpcClient) {
  const loadedIds = await loadedThreadIds(client);
  if (loadedIds.size === 0) return [];

  const activeThreads: AppServerThread[] = [];
  const unresolvedIds = new Set(loadedIds);
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    // `thread/loaded/list` exposes ids only. Resuming every id merely to inspect metadata
    // attaches Gateway to an unbounded history and competes with foreground work on the
    // Host's single RPC connection. The state-DB list is the official metadata path; only
    // active main-thread candidates are resumed below.
    const page: AppServerThreadListPage = await client.request(
      "thread/list",
      {
        cursor,
        limit: 100,
        sortDirection: "desc",
        useStateDbOnly: true,
        sourceKinds: ["cli", "vscode", "exec", "appServer"],
      },
      RECOVERY_TIMEOUT_MS,
      parseThreadListPage,
    );
    for (const thread of page.data) {
      if (!unresolvedIds.delete(thread.id)) continue;
      if (isActive(thread) && !isAppServerSubAgentThread(thread)) activeThreads.push(thread);
    }
    const nextCursor: string | null = page.nextCursor;
    if (
      unresolvedIds.size === 0 ||
      nextCursor === null ||
      nextCursor === "" ||
      seenCursors.has(nextCursor)
    ) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor !== null);
  return activeThreads;
}

function isActive(thread: AppServerThread) {
  return isThreadActiveStatus(thread.status);
}

function startedThread(message: unknown) {
  const params = recordFromUnknown(recordFromUnknown(message)?.params);
  return appServerThreadFromUnknown(params?.thread);
}

function requiredUserId() {
  const userId = currentGatewayUserId();
  if (userId === null) {
    throw new Error("Active main thread monitor requires an authenticated user scope");
  }
  return userId;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMissingRolloutError(error: unknown) {
  const message = messageFromError(error).toLowerCase();
  return message.includes("no rollout found") || message.includes("rollout not found");
}

export const activeMainThreadMonitor = new ActiveMainThreadMonitor();
