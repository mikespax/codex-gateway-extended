import type { AppServerEventParams } from "./app-server-event-handlers/types";

export type ItemLifecyclePhase = "started" | "completed";

export function itemLifecycleTimestampMs(params: AppServerEventParams, phase: ItemLifecyclePhase) {
  const field = phase === "started" ? "startedAtMs" : "completedAtMs";
  const timestamp = params[field];
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new TypeError("Codex app-server " + field + " must be a finite number");
  }
  return timestamp;
}
