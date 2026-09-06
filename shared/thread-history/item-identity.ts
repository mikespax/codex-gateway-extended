import type { ThreadHistoryItem, ThreadHistoryTurn } from "./types";

export function itemId(item: ThreadHistoryItem | null | undefined) {
  return identifier(item?.id);
}

export function itemClientId(item: ThreadHistoryItem | null | undefined) {
  return identifier(item?.clientId);
}

export function turnId(turn: ThreadHistoryTurn | null | undefined) {
  return identifier(turn?.id);
}

export function paramsTurnId(params: Record<string, unknown> | null | undefined) {
  const value = params?.turnId;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function isClientOnlyItem(item: ThreadHistoryItem | null | undefined) {
  return item?.type === "userMessage" && itemClientId(item) !== "" && turnIdForItem(item) === "";
}

export function syntheticTurnIdForItem(item: ThreadHistoryItem | null | undefined) {
  if (isClientOnlyItem(item)) {
    return `client-${itemClientId(item)}`;
  }
  if (item?.type === "threadGoal" && itemId(item) !== "" && turnIdForItem(item) === "") {
    return `system-${itemId(item)}`;
  }
  return "";
}

function turnIdForItem(item: ThreadHistoryItem | null | undefined) {
  return identifier(item?.turnId);
}

function identifier(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function sameItem(
  left: ThreadHistoryItem | null | undefined,
  right: ThreadHistoryItem | null | undefined,
) {
  const leftId = itemId(left);
  const rightId = itemId(right);
  if (leftId && rightId && leftId === rightId) {
    return true;
  }

  const leftClientId = itemClientId(left);
  const rightClientId = itemClientId(right);
  return Boolean(leftClientId && rightClientId && leftClientId === rightClientId);
}

export function findTurnForItem(turns: ThreadHistoryTurn[], item: ThreadHistoryItem) {
  for (const turn of turns) {
    if (!Array.isArray(turn?.items)) {
      continue;
    }
    const itemIndex = turn.items.findIndex((candidate) => sameItem(candidate, item));
    if (itemIndex >= 0) {
      return { turn, itemIndex };
    }
  }
  return null;
}
