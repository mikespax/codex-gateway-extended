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

export async function sendTurn(t: Translate, text: string, options: ComposerTurnOptions = {}) {
  const sessionIsCurrent = captureSessionEpoch();
  const catalog = useGatewayCatalogStore();
  const gateway = useGatewayBootstrapStore();
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  const runtimeStore = useGatewayThreadRuntimeStore();
  const views = useGatewayThreadViewStore();
  const hostId = navigation.selectedHostId;
  const threadId = navigation.selectedThreadId;
  if (hostId === null || threadId === null) {
    return;
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
    if (!sessionIsCurrent()) return;
    project = resolveCurrentProject();
  }
  if (project === undefined) {
    gateway.setError(t("app.projectRequiredForFileReferences"), { hostId, threadId });
    return;
  }
  const projectId = project.id;
  // Heal stale route/cache state so later actions cannot keep submitting a foreign host project.
  if (targetIsSelected() && navigation.selectedProjectId !== projectId) {
    navigation.selectedProjectId = projectId;
    syncSelectedRoute({ replace: true });
  }
  const cwd = project.remotePath;
  const runtime = runtimeStore.threadRuntimeProjection(hostId, threadId);
  const steerTurnId = runtime.canSteer ? runtime.activeTurnId : null;
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
    if (!sessionIsCurrent()) return;
    applyAcceptedTurnResult(hostId, threadId, result, clientUserMessageId, optimisticContent);
    if (!shouldSteerActiveTurn) {
      composer.setThreadSettings(hostId, threadId, {
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.effort !== undefined ? { effort: options.effort } : {}),
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.approvalPolicy !== undefined ? { approvalPolicy: options.approvalPolicy } : {}),
      });
    }
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    useGatewayThreadTurnsStore().clearRequest(hostId, threadId);
    gateway.setError(messageFromError(error, t("app.sendMessageFailed"), errorMessageLabels(t)), {
      hostId,
      projectId,
      threadId,
    });
    if (!shouldSteerActiveTurn) {
      runtimeStore.setThreadStatus(hostId, threadId, "completed");
    }
  } finally {
    if (sessionIsCurrent() && targetIsSelected()) views.loading = false;
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
