import type { GatewayEvent, ThreadGoalStatus } from "~~/shared/types";
import { terminalTurnStatus } from "~~/shared/thread-runtime-status";
import { gatewayMemoryState } from "../state/memory";
import { hostStore } from "../state/hosts";
import type { ServerNotification } from "~~/shared/types";
import { threadGoalFromUnknown, threadHistoryTurnFromUnknown } from "~~/shared/runtime/app-server";
import { idFromUnknown, recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export function threadTurnCompletedNotification(event: GatewayEvent): ServerNotification | null {
  const params = recordFromUnknown(event.payload.params);
  const turn = threadHistoryTurnFromUnknown(params?.turn) ?? {};
  const turnId = turn.id === null || turn.id === undefined ? `event-${event.id}` : String(turn.id);
  const status = terminalTurnStatus(turn.status);
  // A user pressing Stop still produces app-server's terminal turn/completed event, but it is not
  // a completion that needs a push. Keep failure and ordinary completion notifications intact.
  if (status === "interrupted") {
    return null;
  }
  return {
    key: `thread-terminal:${event.hostId}:${event.threadId}:turn:${turnId}:${status}`,
    title: threadTitle(event.hostId, event.threadId),
    body: "",
    group: "Codex Gateway",
    target: notificationTarget(event),
  };
}

export function threadGoalCompletedNotification(event: GatewayEvent): ServerNotification | null {
  const params = recordFromUnknown(event.payload.params);
  const goal = threadGoalFromUnknown(params?.goal);
  if (goal === null || !isTerminalGoalStatus(goal.status)) {
    return null;
  }
  return {
    key: `thread-goal:${event.hostId}:${event.threadId}:${goal.status}:${goal.updatedAt}`,
    title: `${threadTitle(event.hostId, event.threadId)} · Goal finished`,
    body: [
      `${hostTitle(event.hostId)} goal status: ${goalStatusLabel(goal.status)}. `,
      `Ran for ${formatDuration(goal.timeUsedSeconds)} and used ${goal.tokensUsed.toLocaleString("en-US")} tokens.`,
    ].join(""),
    group: "Codex Gateway",
    target: notificationTarget(event),
  };
}

export function threadUserInputRequestedNotification(event: GatewayEvent): ServerNotification {
  const params = recordFromUnknown(event.payload.params);
  const questions = Array.isArray(params?.questions) ? params.questions : [];
  const firstQuestion = recordFromUnknown(questions[0]);
  const question = firstNonEmptyString([
    stringFromUnknown(firstQuestion?.question),
    stringFromUnknown(firstQuestion?.header),
  ]);
  // itemId belongs to the thread history and survives app-server restarts. Numeric RPC ids restart
  // from zero with each process, so they are only a fallback when older payloads omit itemId.
  const requestId = idFromUnknown(params?.itemId) ?? idFromUnknown(event.payload.id) ?? event.id;
  const questionCount = questions.length > 1 ? ` (${questions.length} questions)` : "";

  return {
    key: `thread-user-input:${event.hostId}:${event.threadId}:${requestId}`,
    title: `${threadTitle(event.hostId, event.threadId)} · Awaiting your response`,
    // Options may contain secrets or large model-generated payloads. A push notification only
    // needs enough context to bring the user back; the interactive card remains authoritative.
    body: `${hostTitle(event.hostId)} Agent is waiting for your response${questionCount}: ${question ?? "Open the thread to view the question."}`,
    group: "Codex Gateway",
    target: notificationTarget(event),
  };
}

export function isTerminalGoalStatus(status: ThreadGoalStatus) {
  return status !== "active" && status !== "paused";
}

function notificationTarget(event: GatewayEvent) {
  const pinnedThread = gatewayMemoryState.pinnedThreads.find(
    (thread) => thread.hostId === event.hostId && thread.threadId === event.threadId,
  );
  const metadata = gatewayMemoryState.threadMetadata.find(
    (thread) => thread.hostId === event.hostId && thread.threadId === event.threadId,
  );
  return {
    kind: "thread" as const,
    hostId: event.hostId,
    projectId: pinnedThread?.projectId ?? metadata?.projectId ?? null,
    threadId: event.threadId,
  };
}

function threadTitle(hostId: number, threadId: string) {
  const pinnedThread = gatewayMemoryState.pinnedThreads.find(
    (thread) => thread.hostId === hostId && thread.threadId === threadId,
  );
  const metadata = gatewayMemoryState.threadMetadata.find(
    (thread) => thread.hostId === hostId && thread.threadId === threadId,
  );
  return (
    firstNonEmptyString([
      pinnedThread?.title,
      metadata?.title,
      metadata?.name,
      metadata?.preview,
    ]) ?? threadId
  );
}

function hostTitle(hostId: number) {
  return firstNonEmptyString([hostStore.get(hostId)?.name]) ?? `Host ${hostId}`;
}

function goalStatusLabel(status: ThreadGoalStatus) {
  const labels: Record<ThreadGoalStatus, string> = {
    active: "active",
    paused: "paused",
    blocked: "blocked",
    usageLimited: "usage limited",
    budgetLimited: "budget exhausted",
    complete: "completed",
  };
  return labels[status];
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (minutes <= 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}
