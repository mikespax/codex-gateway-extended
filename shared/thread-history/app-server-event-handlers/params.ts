import type { ThreadHistoryItem, ThreadHistoryTurn } from "../types";
import {
  threadHistoryItemFromUnknown,
  threadHistoryTurnFromUnknown,
} from "../../runtime/app-server";
import type { AppServerEventParams } from "./types";

export function idParam(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export function itemParam(params: AppServerEventParams, key = "item"): ThreadHistoryItem | null {
  return threadHistoryItemFromUnknown(params[key]);
}

export function turnParam(params: AppServerEventParams, key = "turn"): ThreadHistoryTurn | null {
  return threadHistoryTurnFromUnknown(params[key]);
}
