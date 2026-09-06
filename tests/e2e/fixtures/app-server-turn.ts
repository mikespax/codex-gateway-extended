import type { AppServerTurn, ThreadHistoryItem } from "../../../shared/types";

export type AppServerTurnFixture = Pick<AppServerTurn, "id"> &
  Partial<Omit<AppServerTurn, "id" | "items">> & {
    items?: ThreadHistoryItem[];
  };

export function appServerTurnFixture(fixture: AppServerTurnFixture): AppServerTurn {
  return {
    items: [],
    itemsView: "full",
    status: "inProgress",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...fixture,
  };
}
