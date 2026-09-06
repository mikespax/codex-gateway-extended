import { itemId, turnId } from "./item-identity";
import { ensureHistoryThread } from "./shape";
import type { ThreadHistoryItem, ThreadHistorySeed, ThreadHistoryState } from "./types";

export function updateItemInTurnById(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  turnIdValue: string,
  itemIdValue: string,
  createItem: () => ThreadHistoryItem,
  updateItem: (item: ThreadHistoryItem) => ThreadHistoryItem,
): ThreadHistoryState {
  const nextHistory = ensureHistoryThread(history, currentThread, threadId);
  const turns = nextHistory.thread.turns;
  let turnIndex = turns.findIndex((candidate) => turnId(candidate) === turnIdValue);
  let turn = turnIndex >= 0 ? turns[turnIndex] : null;
  if (!turn) {
    turn = { id: turnIdValue, items: [], status: "inProgress" };
    turns.push(turn);
    turnIndex = turns.length - 1;
  }
  if (!Array.isArray(turn.items)) {
    return nextHistory;
  }

  const items = [...turn.items];
  turn = { ...turn, items };
  const index = items.findIndex((candidate) => itemId(candidate) === itemIdValue);
  if (index >= 0) {
    const existingItem = items[index];
    if (!existingItem) {
      return nextHistory;
    }
    items[index] = updateItem({
      ...existingItem,
      status: existingItem.status ?? "inProgress",
    });
  } else {
    items.push(createItem());
  }
  turns[turnIndex] = turn;
  nextHistory.thread.turns = [...turns];
  return nextHistory;
}
