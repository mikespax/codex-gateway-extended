import { SERVER_TURN_CACHE_LIMIT } from "~~/shared/config";
import type { ThreadHistorySeed, ThreadHistoryState } from "~~/shared/types";
import type { TurnsPage } from "./types";

export function pageToFullHistory(thread: ThreadHistorySeed, page: TurnsPage): ThreadHistoryState {
  const turns = [...(page.data ?? [])].reverse().slice(-SERVER_TURN_CACHE_LIMIT);
  return {
    thread: {
      id: thread.id,
      turns,
    },
  };
}

export function pageCursorState(page: TurnsPage) {
  return {
    nextCursor: page.nextCursor ?? null,
    backwardsCursor: page.backwardsCursor ?? null,
  };
}
