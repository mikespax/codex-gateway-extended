import type { ThreadHistoryItem, ThreadHistoryState } from "~~/shared/types";
import { threadTurnsFromHistory } from "~~/shared/thread-history/shape";
import { recordFromUnknown } from "~~/shared/utils/records";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export function isThreadPlanItem(item: ThreadHistoryItem) {
  return item?.type === "plan" || item?.type === "turnPlan";
}

export function isThreadPlanItemCompleted(item: ThreadHistoryItem) {
  return item?.type === "turnPlan" || statusValue(item?.status) === "completed";
}

export function latestThreadPlanItem(history: ThreadHistoryState | null) {
  const turns = threadTurnsFromHistory(history);
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const items = turn?.items ?? [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item !== undefined && isThreadPlanItem(item)) {
        return item;
      }
    }
  }
  return null;
}

export function planItemSummary(item: ThreadHistoryItem | null | undefined) {
  if (item === null || item === undefined) {
    return "";
  }
  if (item.type === "turnPlan") {
    return (
      firstNonEmptyString([
        textValue(item.explanation),
        Array.isArray(item.plan) ? textValue(recordFromUnknown(item.plan[0])?.step) : null,
      ]) ?? ""
    );
  }
  return firstNonEmptyString([textValue(item.text), textValue(item.explanation)]) ?? "";
}

function statusValue(status: unknown) {
  return typeof status === "string" ? status : recordFromUnknown(status)?.type;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}
