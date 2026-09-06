import { mergeItemIntoLatestTurn } from "../items";
import { idParam, itemParam } from "./params";
import type {
  AppServerEventParams,
  AppServerHistoryReducerRegistry,
  ApplyAppServerEventInput,
} from "./types";
import { recordFromUnknown, stringFromUnknown } from "../../utils/records";
import type { ThreadFileChange } from "../types";
import { itemLifecycleTimestampMs, type ItemLifecyclePhase } from "../item-lifecycle-timing";

let fileChangeSequence = 0;

export const itemLifecycleReducers = {
  "item/started": (input, params) => upsertStartedOrCompletedItem(input, params, "started"),

  "item/completed": (input, params) => upsertStartedOrCompletedItem(input, params, "completed"),

  "item/commandExecution/requestApproval": (input, params, requestId) =>
    mergeItemIntoLatestTurn(input.history, input.currentThread, input.threadId, {
      type: "commandExecution",
      id: idParam(params.itemId),
      turnId: idParam(params.turnId),
      status: "waitingForApproval",
      command: stringFromUnknown(params.command),
      cwd: stringFromUnknown(params.cwd),
      pendingApproval: {
        requestId,
        method: input.method,
        params,
      },
    }),

  "item/fileChange/requestApproval": (input, params, requestId) =>
    mergeItemIntoLatestTurn(input.history, input.currentThread, input.threadId, {
      type: "fileChange",
      id: idParam(params.itemId),
      turnId: idParam(params.turnId),
      status: "waitingForApproval",
      pendingApproval: {
        requestId,
        method: input.method,
        params,
      },
    }),

  "item/fileChange/patchUpdated": (input, params) =>
    mergeItemIntoLatestTurn(input.history, input.currentThread, input.threadId, {
      type: "fileChange",
      id: idParam(params.itemId),
      turnId: idParam(params.turnId),
      changes: tagFileChanges(params.changes),
      status: "inProgress",
    }),
} satisfies AppServerHistoryReducerRegistry;

function upsertStartedOrCompletedItem(
  input: ApplyAppServerEventInput,
  params: AppServerEventParams,
  phase: ItemLifecyclePhase,
) {
  const item = itemParam(params);
  if (item === null) {
    return input.history;
  }
  // App-server 0.147 reports the actual lifecycle instant. Envelope emission can happen later,
  // especially over slow SSH, so it must not be used to calculate item durations.
  const lifecycleTimestamp = itemLifecycleTimestampMs(params, phase);
  return mergeItemIntoLatestTurn(input.history, input.currentThread, input.threadId, {
    ...item,
    turnId: idParam(params.turnId),
    status: item.status ?? (phase === "started" ? "inProgress" : "completed"),
    ...(phase === "started" ? { startedAt: lifecycleTimestamp } : {}),
    ...(phase === "completed" ? { completedAt: lifecycleTimestamp } : {}),
  });
}

function tagFileChanges(changes: unknown): ThreadFileChange[] {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes.flatMap((change) => {
    const record = recordFromUnknown(change);
    if (record === null) return [];
    const kindRecord = recordFromUnknown(record.kind);
    const kind =
      typeof record.kind === "string"
        ? record.kind
        : kindRecord
          ? {
              type: stringFromUnknown(kindRecord.type),
              kind: stringFromUnknown(kindRecord.kind),
            }
          : null;
    return [{ ...record, kind, sequence: ++fileChangeSequence }];
  });
}
