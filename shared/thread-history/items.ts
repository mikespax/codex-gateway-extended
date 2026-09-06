import { findTurnForItem, sameItem, syntheticTurnIdForItem, turnId } from "./item-identity";
import { mergeThreadItem } from "./item-merge";
import { ensureHistoryThread } from "./shape";
import type { ThreadHistoryItem, ThreadHistorySeed, ThreadHistoryState } from "./types";

export function mergeItemIntoLatestTurn(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  item: ThreadHistoryItem,
): ThreadHistoryState {
  const nextHistory = ensureHistoryThread(history, currentThread, threadId);
  const itemTurnId =
    typeof item.turnId === "string" || typeof item.turnId === "number" ? String(item.turnId) : "";
  const syntheticTurnId = syntheticTurnIdForItem(item);
  if (!itemTurnId && !syntheticTurnId) {
    return nextHistory;
  }
  const turns = nextHistory.thread.turns;
  const existing = findTurnForItem(turns, item);
  if (existing) {
    const existingItems = [...(existing.turn.items ?? [])];
    const existingItem = existingItems[existing.itemIndex];
    if (!existingItem) {
      return nextHistory;
    }
    existing.turn.items = existingItems;
    existing.turn.items[existing.itemIndex] = mergeThreadItem(existingItem, item);
    nextHistory.thread.turns = [...turns];
    return nextHistory;
  }

  const targetTurnId = itemTurnId || syntheticTurnId;
  let turnIndex = turns.findIndex((candidate) => turnId(candidate) === targetTurnId);
  let turn = turnIndex >= 0 ? turns[turnIndex] : null;
  if (!turn) {
    turn = { id: targetTurnId, items: [], status: statusForNewTurn(item) };
    turns.push(turn);
    turnIndex = turns.length - 1;
  }
  if (!Array.isArray(turn.items)) {
    return nextHistory;
  } else {
    turn.items = [...turn.items];
  }

  const index = turn.items.findIndex((candidate) => sameItem(candidate, item));
  if (index >= 0) {
    const existingItem = turn.items[index];
    if (existingItem) {
      turn.items[index] = mergeThreadItem(existingItem, item);
    }
  } else {
    turn.items.push(item);
  }
  turns[turnIndex] = turn;
  nextHistory.thread.turns = [...turns];
  return nextHistory;
}

function statusForNewTurn(item: ThreadHistoryItem) {
  const status = typeof item?.status === "string" ? item.status : item?.status?.type;
  return isActiveItemStatus(status) ? "inProgress" : "completed";
}

function isActiveItemStatus(status: unknown) {
  return (
    status === "inProgress" ||
    status === "running" ||
    status === "active" ||
    status === "waitingForClient" ||
    status === "waitingForApproval"
  );
}

export function insertSteerItemIntoActiveTurn(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  turnIdValue: string,
  item: ThreadHistoryItem,
): ThreadHistoryState {
  const nextHistory = ensureHistoryThread(history, currentThread, threadId);
  if (turnIdValue.length === 0) {
    return nextHistory;
  }
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

  const existing = findTurnForItem(turns, item);
  if (existing) {
    const existingItems = [...(existing.turn.items ?? [])];
    const existingItem = existingItems[existing.itemIndex];
    if (!existingItem) {
      return nextHistory;
    }
    existing.turn.items = existingItems;
    existing.turn.items[existing.itemIndex] = mergeThreadItem(existingItem, item);
    nextHistory.thread.turns = [...turns];
    return nextHistory;
  }

  turn = { ...turn, items: [...turn.items, item] };
  turns[turnIndex] = turn;
  nextHistory.thread.turns = [...turns];
  return nextHistory;
}
