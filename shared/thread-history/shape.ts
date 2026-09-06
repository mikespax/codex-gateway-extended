import type { ThreadHistorySeed, ThreadHistoryState, ThreadHistoryTurn } from "./types";

export function threadTurnsFromHistory(history: ThreadHistoryState | null): ThreadHistoryTurn[] {
  return history?.thread.turns ?? [];
}

export function ensureHistoryThread(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
): ThreadHistoryState {
  const existingThread = history?.thread ?? currentThread ?? { id: threadId };
  return {
    thread: {
      id: existingThread.id || threadId,
      turns: [...(existingThread.turns ?? [])],
    },
  };
}
