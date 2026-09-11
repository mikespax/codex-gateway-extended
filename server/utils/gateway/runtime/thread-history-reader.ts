import type { HostRecord } from "~~/shared/types";
import type { ControllerRegistry } from "./controller-registry";
import { pageCursorState, pageToFullHistory } from "./thread-history-pages";
import { DEFAULT_TURN_PAGE_LIMIT } from "./types";
import { parseTurnsPage } from "~~/shared/runtime/app-server";
import { projectThreadTimelineHistory } from "~~/shared/thread-history/timeline";

export interface ThreadTurnsListInput {
  cursor?: string | null;
  limit?: number;
  sortDirection?: "asc" | "desc";
  itemsView?: "summary" | "full";
}

export class ThreadHistoryReader {
  constructor(private readonly registry: ControllerRegistry) {}

  async listThreadTurns(host: HostRecord, threadId: string, input: ThreadTurnsListInput) {
    const client = await this.registry.getHostClient(host);
    const page = await client.request(
      "thread/turns/list",
      {
        threadId,
        cursor: input.cursor ?? null,
        limit: input.limit ?? DEFAULT_TURN_PAGE_LIMIT,
        sortDirection: input.sortDirection ?? "desc",
        // Older-page requests are explicit user navigation. Preserve the existing full-content
        // behavior there; cold opens use the bounded summary page in ThreadController instead.
        itemsView: input.itemsView ?? "full",
      },
      120_000,
      parseTurnsPage,
    );

    return {
      history: projectThreadTimelineHistory(pageToFullHistory({ id: threadId }, page)),
      turnsPage: pageCursorState(page),
    };
  }
}
