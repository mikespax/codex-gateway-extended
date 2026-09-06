import type { ThreadHistoryItem, ThreadHistoryState, ThreadHistoryTurn } from "~~/shared/types";
import { threadTurnsFromHistory } from "~~/shared/thread-history/shape";
import { recordFromUnknown } from "~~/shared/utils/records";

export function activeRemoteTurnId(history: ThreadHistoryState | null | undefined) {
  const turns = threadTurnsFromHistory(history ?? null);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    const status = statusValue(turn.status);
    const id = turn.id === undefined || turn.id === null ? "" : String(turn.id);
    if (
      (isRunningTurnStatus(status) ||
        hasPostTurnActiveItems(turn) ||
        (!isTerminalTurnStatus(status) && hasRunningItems(turn))) &&
      id !== "" &&
      !id.startsWith("client-")
    ) {
      return id;
    }
  }
  return null;
}

export function activeTurnIdFromRuntimeState(
  history: ThreadHistoryState | null | undefined,
  activeTurnId: string | null | undefined,
) {
  return (
    activeRemoteTurnId(history) ??
    (activeTurnId === null || activeTurnId === undefined || activeTurnId === ""
      ? null
      : activeTurnId)
  );
}

function isRunningTurnStatus(status: unknown) {
  return (
    status === "inProgress" ||
    status === "in_progress" ||
    status === "running" ||
    status === "active" ||
    status === "pending" ||
    status === "starting" ||
    status === "waitingForClient" ||
    status === "waitingForApproval"
  );
}

function isTerminalTurnStatus(status: unknown) {
  return status === "completed" || status === "failed" || status === "interrupted";
}

function hasRunningItems(turn: ThreadHistoryTurn) {
  return (
    Array.isArray(turn?.items) &&
    turn.items.some((item) => isRunningTurnStatus(statusValue(item.status)))
  );
}

function hasPostTurnActiveItems(turn: ThreadHistoryTurn) {
  return (
    Array.isArray(turn?.items) &&
    turn.items.some((item: ThreadHistoryItem) => {
      const type = typeof item?.type === "string" ? item.type : "";
      const status = statusValue(item.status);
      return (type === "contextCompaction" || type === "sleep") && isRunningTurnStatus(status);
    })
  );
}

function statusValue(status: unknown) {
  return typeof status === "string" ? status : recordFromUnknown(status)?.type;
}
