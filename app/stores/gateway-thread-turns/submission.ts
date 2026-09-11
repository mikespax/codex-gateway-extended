import type {
  ComposerTurnOptions,
  ProjectDirectoryAvailability,
  ProjectRecord,
} from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import {
  errorMessageLabels,
  messageFromError,
  pinnedKey,
} from "@/stores/gateway/thread-utils/identity";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import {
  cacheSelectedThreadView,
  requestScrollToLatest,
  syncSelectedRoute,
} from "@/stores/gateway/thread-open/view-state";
import {
  createClientUserMessageId,
  optimisticUserContent,
} from "@/stores/gateway/thread-turns/turn-content";
import {
  insertOptimisticNewTurnMessage,
  insertOptimisticSteerMessage,
  mergeStartedTurn,
  mergeTurnItems,
} from "./history";
import { runTurnRequestWithAutoRetry } from "./retry";
import { requestTurnStart, requestTurnSteer } from "./transport";
import type { Translate, TurnRequestResult } from "./types";
import { captureSessionEpoch } from "@/utils/session-epoch";

export type TurnDispatchMode = "auto" | "queue" | "steer" | "start";

export interface TurnDispatchOptions {
  mode?: TurnDispatchMode;
}

export async function sendTurn(
  t: Translate,
  text: string,
  options: ComposerTurnOptions = {},
  dispatch: TurnDispatchOptions = {},
): Promise<boolean> {
  const sessionIsCurrent = captureSessionEpoch();
  const catalog = useGatewayCatalogStore();
  const gateway = useGatewayBootstrapStore();
  const config = useGatewayConfigStore();
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  const runtimeStore = useGatewayThreadRuntimeStore();
  const views = useGatewayThreadViewStore();
  const hostId = navigation.selectedHostId;
  const threadId = navigation.selectedThreadId;
  if (hostId === null || threadId === null) {
    return false;
  }
  const targetIsSelected = () =>
    navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId;
  cacheSelectedThreadView();

  const selectedProjectId = navigation.selectedProjectId;
  const resolveCurrentProject = () =>
    resolveTurnProject({
      projects: catalog.projects,
      availability: catalog.projectDirectoryAvailability,
      hostId,
      hostUsername: catalog.hosts.find((host) => host.id === hostId)?.username ?? null,
      selectedProjectId,
      threadCwd: useGatewayThreadActivityStore().summariesByKey[pinnedKey(hostId, threadId)]?.cwd,
    });
  let project = resolveCurrentProject();
  if (project === undefined) {
    // A route can select a thread before background host discovery has populated the project
    // catalog. Treat the first submit as a readiness boundary instead of rejecting it and forcing
    // the user to send the same message again after hydration happens to finish.
    await navigation.refreshHostProjects(hostId);
    if (!sessionIsCurrent()) return false;
    project = resolveCurrentProject();
  }
  if (project === undefined) {
    gateway.setError(t("app.projectRequiredForFileReferences"), { hostId, threadId });
    return false;
  }
  const projectId = project.id;
  // Heal stale route/cache state so later actions cannot keep submitting a foreign host project.
  if (targetIsSelected() && navigation.selectedProjectId !== projectId) {
    navigation.selectedProjectId = projectId;
    syncSelectedRoute({ replace: true });
  }
  const cwd = project.remotePath;
  const runtime = runtimeStore.threadRuntimeProjection(hostId, threadId);
  const dispatchMode = dispatch.mode ?? "auto";
  const activeTurnId = runtime.canSteer ? runtime.activeTurnId : null;
  // A queued item is dispatched only after the previous turn is terminal. If a status update races
  // with that flush, leave the item in the local queue for the next terminal notification.
  if (dispatchMode === "start" && activeTurnId !== null) return false;
  const steerTurnId =
    dispatchMode === "steer" || (dispatchMode === "auto" && activeTurnId !== null)
      ? activeTurnId
      : null;
  if (dispatchMode === "queue" && activeTurnId !== null) {
    try {
      useGatewayThreadTurnsStore().queueTurn({
        hostId,
        projectId,
        threadId,
        cwd,
        text,
        options,
      });
      return true;
    } catch (error: unknown) {
      gateway.setError(error instanceof Error ? error.message : t("app.sendMessageFailed"), {
        hostId,
        projectId,
        threadId,
      });
      return false;
    }
  }
  const shouldSteerActiveTurn = steerTurnId !== null;
  const clientUserMessageId = createClientUserMessageId(shouldSteerActiveTurn ? "steer" : "turn");
  if (!shouldSteerActiveTurn) {
    runtimeStore.setThreadRunning(hostId, threadId, true);
  }

  // Sending is an explicit request to show the new user message, even if a completed-turn collapse
  // or restored layout left the strict two-pixel end detector detached. Issue the command before
  // the optimistic append; the viewport consumes it after Vue commits that row and uses TanStack's
  // public scrollToEnd transaction instead of writing scrollTop directly.
  if (targetIsSelected()) requestScrollToLatest();
  const optimisticContent = optimisticUserContent(text, options);
  if (steerTurnId !== null) {
    insertOptimisticSteerMessage(
      hostId,
      threadId,
      steerTurnId,
      clientUserMessageId,
      optimisticContent,
    );
  } else {
    insertOptimisticNewTurnMessage(hostId, threadId, clientUserMessageId, optimisticContent);
  }

  const requestKind = shouldSteerActiveTurn ? "steer" : "start";
  const executeTurnRequest =
    steerTurnId !== null
      ? () =>
          requestTurnSteer({
            hostId,
            threadId,
            projectId,
            expectedTurnId: steerTurnId,
            text,
            clientUserMessageId,
            cwd,
            options,
          })
      : () =>
          requestTurnStart({
            hostId,
            threadId,
            projectId,
            text,
            clientUserMessageId,
            cwd,
            options,
          });

  if (targetIsSelected()) views.loading = true;
  gateway.clearError();
  try {
    const result = await runTurnRequestWithAutoRetry<TurnRequestResult>(
      t,
      { kind: requestKind, hostId, projectId, threadId, cwd, text, options },
      executeTurnRequest,
    );
    if (!sessionIsCurrent()) return false;
    applyAcceptedTurnResult(hostId, threadId, result, clientUserMessageId, optimisticContent);
    await promoteInactivePinnedThread(config, hostId, threadId);
    if (!shouldSteerActiveTurn) {
      composer.setThreadSettings(hostId, threadId, {
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.effort !== undefined ? { effort: options.effort } : {}),
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.approvalPolicy !== undefined ? { approvalPolicy: options.approvalPolicy } : {}),
      });
    }
    return true;
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return false;
    useGatewayThreadTurnsStore().clearRequest(hostId, threadId);
    gateway.setError(messageFromError(error, t("app.sendMessageFailed"), errorMessageLabels(t)), {
      hostId,
      projectId,
      threadId,
    });
    if (!shouldSteerActiveTurn) {
      runtimeStore.setThreadStatus(hostId, threadId, "completed");
    }
    return false;
  } finally {
    if (sessionIsCurrent() && targetIsSelected()) views.loading = false;
  }
}

/** Dispatch the oldest browser-queued follow-up after the active turn reaches a terminal state. */
export async function flushQueuedTurn(t: Translate, hostId: number, threadId: string) {
  const turns = useGatewayThreadTurnsStore();
  if (!turns.beginQueueFlush(hostId, threadId)) return false;
  try {
    const runtime = useGatewayThreadRuntimeStore().threadRuntimeProjection(hostId, threadId);
    if (runtime.status === "running") return false;
    const queued = turns.takeQueuedTurn(hostId, threadId);
    if (queued === null) return false;
    const accepted = await sendTurn(t, queued.text, queued.options, { mode: "start" });
    if (!accepted) turns.prependQueuedTurn(queued);
    return accepted;
  } finally {
    turns.endQueueFlush(hostId, threadId);
  }
}

/** Send one editable queued item immediately through Codex's official steer path. */
export async function steerQueuedTurn(
  t: Translate,
  hostId: number,
  threadId: string,
  queuedId: string,
) {
  const turns = useGatewayThreadTurnsStore();
  const queued = turns.takeQueuedTurn(hostId, threadId, queuedId);
  if (queued === null) return false;
  const accepted = await sendTurn(t, queued.text, queued.options, { mode: "steer" });
  if (!accepted) turns.prependQueuedTurn(queued);
  return accepted;
}

/** A deliberate send reactivates an explicitly inactive pinned thread after acceptance. */
async function promoteInactivePinnedThread(
  config: ReturnType<typeof useGatewayConfigStore>,
  hostId: number,
  threadId: string,
) {
  const thread = config.gatewayConfig.pinnedThreads.find(
    (candidate) => candidate.hostId === hostId && candidate.threadId === threadId,
  );
  if (thread?.inactive !== true) return;
  try {
    await config.setPinnedThreadInactive(thread, false);
  } catch (error: unknown) {
    // The turn was accepted; a config-sync failure must not make the user retry it. The next
    // config refresh can reconcile the row, while the current message remains available.
    console.warn("[gateway] accepted turn could not promote inactive thread", {
      hostId,
      threadId,
      error,
    });
  }
}

function resolveTurnProject(input: {
  projects: ProjectRecord[];
  availability: Record<number, ProjectDirectoryAvailability>;
  hostId: number;
  hostUsername: string | null;
  selectedProjectId: number | null;
  threadCwd: string | null | undefined;
}) {
  const hostProjects = input.projects.filter((project) => project.hostId === input.hostId);
  const isUsable = (project: ProjectRecord) => input.availability[project.id] !== "missing";
  const selected = hostProjects.find(
    (project) => project.id === input.selectedProjectId && isUsable(project),
  );
  if (selected !== undefined) return selected;

  const matchingCwd = hostProjects.find(
    (project) => project.remotePath === input.threadCwd && isUsable(project),
  );
  if (matchingCwd !== undefined) return matchingCwd;

  return hostProjects
    .filter((project) => input.availability[project.id] === "available")
    .sort(
      (left, right) =>
        fallbackProjectRank(left, input.hostUsername) -
          fallbackProjectRank(right, input.hostUsername) || left.id - right.id,
    )[0];
}

function fallbackProjectRank(project: ProjectRecord, username: string | null) {
  const homePaths =
    username === null
      ? []
      : username === "root"
        ? ["/root"]
        : [`/Users/${username}`, `/home/${username}`];
  if (homePaths.includes(project.remotePath)) return 0;
  if (project.remotePath.endsWith("/.codex")) return 1;
  return 10 + project.remotePath.split("/").filter(Boolean).length;
}

function applyAcceptedTurnResult(
  hostId: number,
  threadId: string,
  result: TurnRequestResult | undefined,
  clientUserMessageId: string,
  optimisticContent: unknown[],
) {
  const runtime = useGatewayThreadRuntimeStore();
  if (result?.type === "turn.start.accepted" && result.turn !== null && result.turn !== undefined) {
    const startedTurnId =
      result.turn.id === null || result.turn.id === undefined ? "" : String(result.turn.id);
    if (startedTurnId !== "" && !startedTurnId.startsWith("client-")) {
      runtime.setThreadStatus(hostId, threadId, "running", { turnId: startedTurnId });
    }
    mergeStartedTurn(hostId, threadId, result.turn);
  }
  if (
    result?.type === "turn.start.accepted" &&
    result.turn?.items !== null &&
    result.turn?.items !== undefined &&
    result.turn.items.length > 0
  ) {
    mergeTurnItems(hostId, threadId, result.turn);
  }
  if (
    result?.type === "turn.steer.accepted" &&
    result.turnId !== undefined &&
    result.turnId !== ""
  ) {
    insertOptimisticSteerMessage(
      hostId,
      threadId,
      result.turnId,
      clientUserMessageId,
      optimisticContent,
    );
  }
}
