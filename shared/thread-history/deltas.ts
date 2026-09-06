import { paramsTurnId } from "./item-identity";
import { ensureHistoryThread } from "./shape";
import { updateItemInTurnById } from "./turn-item-mutations";
import type { ThreadHistoryItem, ThreadHistorySeed, ThreadHistoryState } from "./types";
import { stringFromUnknown } from "../utils/records";

export function appendAgentDelta(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
): ThreadHistoryState {
  const itemIdValue = stringParam(params, "itemId");
  const turnIdValue = paramsTurnId(params);
  const delta = typeof params.delta === "string" ? params.delta : "";
  if (!itemIdValue || !turnIdValue || !delta) {
    return ensureHistoryThread(history, currentThread, threadId);
  }

  return updateItemInTurnById(
    history,
    currentThread,
    threadId,
    turnIdValue,
    itemIdValue,
    () => ({
      type: "agentMessage",
      id: itemIdValue,
      text: delta,
      phase: "final_answer",
      turnId: turnIdValue,
      status: "inProgress",
    }),
    (item) => ({ ...item, text: `${stringItemField(item, "text")}${delta}` }),
  );
}

export function appendPlanDelta(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
): ThreadHistoryState {
  return appendTextDelta(history, currentThread, threadId, params, "plan", (item, delta) => ({
    ...item,
    text: `${stringItemField(item, "text")}${delta}`,
  }));
}

export function appendReasoningSummaryDelta(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
): ThreadHistoryState {
  return appendTextDelta(history, currentThread, threadId, params, "reasoning", (item, delta) => {
    const summary = Array.isArray(item.summary) ? [...item.summary] : [];
    const index = typeof params.summaryIndex === "number" ? params.summaryIndex : summary.length;
    summary[index] = `${stringFromUnknown(summary[index]) ?? ""}${delta}`;
    return { ...item, summary };
  });
}

export function appendReasoningTextDelta(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
): ThreadHistoryState {
  return appendTextDelta(history, currentThread, threadId, params, "reasoning", (item, delta) => {
    const content = Array.isArray(item.content) ? [...item.content] : [];
    const index = typeof params.contentIndex === "number" ? params.contentIndex : content.length;
    content[index] = `${stringFromUnknown(content[index]) ?? ""}${delta}`;
    return { ...item, content };
  });
}

function appendTextDelta(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
  itemType: string,
  update: (item: ThreadHistoryItem, delta: string) => ThreadHistoryItem,
): ThreadHistoryState {
  const itemIdValue = stringParam(params, "itemId");
  const turnIdValue = paramsTurnId(params);
  const delta = typeof params.delta === "string" ? params.delta : "";
  if (!itemIdValue || !turnIdValue || !delta) {
    return ensureHistoryThread(history, currentThread, threadId);
  }

  return updateItemInTurnById(
    history,
    currentThread,
    threadId,
    turnIdValue,
    itemIdValue,
    () =>
      update({ type: itemType, id: itemIdValue, turnId: turnIdValue, status: "inProgress" }, delta),
    (item) => update(item, delta),
  );
}

export function appendCommandOutputDelta(
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
  threadId: string,
  params: Record<string, unknown>,
): ThreadHistoryState {
  const itemIdValue = stringParam(params, "itemId");
  const turnIdValue = paramsTurnId(params);
  const delta = typeof params.delta === "string" ? params.delta : "";
  if (!itemIdValue || !turnIdValue || !delta) {
    return ensureHistoryThread(history, currentThread, threadId);
  }

  return updateItemInTurnById(
    history,
    currentThread,
    threadId,
    turnIdValue,
    itemIdValue,
    () => ({
      type: "commandExecution",
      id: itemIdValue,
      turnId: turnIdValue,
      status: "inProgress",
      aggregatedOutput: delta,
    }),
    (item) => ({
      ...item,
      aggregatedOutput: `${stringItemField(item, "aggregatedOutput")}${delta}`,
    }),
  );
}

function stringParam(params: Record<string, unknown>, key: string) {
  const value = params[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stringItemField(item: ThreadHistoryItem, key: string) {
  const value = item[key];
  return typeof value === "string" ? value : "";
}
