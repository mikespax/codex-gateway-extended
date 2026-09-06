import { ensureHistoryThread } from "./shape";
import type { ThreadHistorySeed, ThreadHistoryState } from "./types";

export function updateTurnDiff(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
): ThreadHistoryState {
  const nextHistory = ensureHistoryThread(history, currentThread, threadId);
  const turnId =
    typeof params.turnId === "string" || typeof params.turnId === "number" ? params.turnId : null;
  if (turnId === null || typeof params.diff !== "string") {
    return nextHistory;
  }
  const turns = nextHistory.thread.turns;
  const turn = turns.find((candidate) => candidate.id === turnId);
  if (!turn) {
    return nextHistory;
  }
  turn.diff = params.diff;
  nextHistory.thread.turns = [...turns];
  return nextHistory;
}
