import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { threadHistoryTurnFromUnknown } from "~~/shared/runtime/app-server";
import { idFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { gatewayDomainEvents } from "../domain-events";
import { runtimeStatusFromCompletedTurn } from "../thread-utils/status";
import type { GatewayEventHandlerRegistry } from "./types";

export const turnEventHandlers: GatewayEventHandlerRegistry = {
  "turn/started": (event, params, threadId) => {
    const turn = threadHistoryTurnFromUnknown(params.turn);
    gatewayDomainEvents.emit("thread-status-detected", {
      hostId: event.hostId,
      threadId,
      status: "running",
      turnId: turn === null ? null : String(turn.id),
    });
    if (turn !== null) {
      gatewayDomainEvents.emit("history-turn-appended", {
        hostId: event.hostId,
        threadId,
        turn,
      });
    }
  },
  "turn/completed": (event, params, threadId) => {
    const turn = threadHistoryTurnFromUnknown(params.turn);
    gatewayDomainEvents.emit("thread-status-detected", {
      hostId: event.hostId,
      threadId,
      status: runtimeStatusFromCompletedTurn(turn),
      turnId: turn === null ? null : String(turn.id),
    });
    if (turn === null) return;
    gatewayDomainEvents.emit("history-turn-synced", {
      hostId: event.hostId,
      threadId,
      turn,
    });
    const turns = useGatewayThreadTurnsStore();
    turns.maybeRetryAfterTurnFailure(event.hostId, threadId, turn);
    if (turn.status !== "failed") turns.clearRequest(event.hostId, threadId);
  },
  "turn/diff/updated": (event, params, threadId) => {
    gatewayDomainEvents.emit("history-turn-diff-updated", {
      hostId: event.hostId,
      threadId,
      params,
    });
  },
  "turn/plan/updated": (event, params, threadId) => {
    const turnId = idFromUnknown(params.turnId);
    if (turnId === null) return;
    gatewayDomainEvents.emit("history-item-upsert", {
      hostId: event.hostId,
      threadId,
      item: {
        type: "turnPlan",
        id: `${turnId}-plan`,
        turnId,
        explanation: stringFromUnknown(params.explanation),
        plan: Array.isArray(params.plan) ? params.plan : [],
      },
    });
  },
};
