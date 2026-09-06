import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { gatewayDomainEvents } from "../domain-events";
import type { ThreadHistoryItem } from "~~/shared/types";
import {
  lastCompletedTurnSummaryFromTurn,
  lastUserInputFromItem,
  lastUserInputFromTurn,
  operationForItem,
} from "@/utils/thread-sidebar-summary";
import {
  clearActiveTerminalProcess,
  rememberActiveTerminalProcess,
} from "../thread-turns/terminal-processes";

export function registerThreadProjectionSubscribers() {
  gatewayDomainEvents.on("thread-summary-detected", (event) => {
    useGatewayThreadActivityStore().upsertAppServerThread(
      event.hostId,
      event.thread,
      useGatewayCatalogStore().projects,
    );
  });
  gatewayDomainEvents.on("remote-files-changed", (event) => {
    useGatewayFileWorkspaceStore().markRemoteFilesChanged(
      event.hostId,
      event.threadId,
      event.paths,
    );
  });
  gatewayDomainEvents.on("thread-status-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadStatus(event.hostId, event.threadId, event.status, {
      turnId: event.turnId,
    });
    const activity = useGatewayThreadActivityStore();
    if (event.status === "running") activity.markTurnRunning(event.hostId, event.threadId);
    else activity.updateCurrentOperation(event.hostId, event.threadId, null);
  });
  gatewayDomainEvents.on("terminal-process-detected", rememberActiveTerminalProcess);
  gatewayDomainEvents.on("terminal-process-completed", clearActiveTerminalProcess);
  gatewayDomainEvents.on("thread-settings-detected", (event) => {
    useGatewayComposerStore().setThreadSettings(event.hostId, event.threadId, event.settings);
  });
  gatewayDomainEvents.on("thread-token-usage-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadTokenUsage(
      event.hostId,
      event.threadId,
      event.tokenUsage,
    );
  });
  gatewayDomainEvents.on("thread-turn-usage-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadTurnUsage(event.hostId, event.usage);
  });
  gatewayDomainEvents.on("history-item-upsert", (event) => {
    const activity = useGatewayThreadActivityStore();
    const lastUserInput = lastUserInputFromItem(event.item);
    if (lastUserInput !== undefined) {
      activity.updateLastUserInput(event.hostId, event.threadId, lastUserInput);
    }
    const operation = operationForHistoryItem(event.item);
    if (operation !== null) {
      activity.updateCurrentOperation(event.hostId, event.threadId, operation);
    }
  });
  gatewayDomainEvents.on("history-turn-appended", (event) => {
    const activity = useGatewayThreadActivityStore();
    const lastUserInput = lastUserInputFromTurn(event.turn);
    if (lastUserInput !== undefined) {
      activity.updateLastUserInput(event.hostId, event.threadId, lastUserInput);
    }
    const turnSummary = lastCompletedTurnSummaryFromTurn(event.turn);
    if (turnSummary !== undefined) {
      activity.updateTurnSummary(event.hostId, event.threadId, turnSummary);
    }
  });
  gatewayDomainEvents.on("history-turn-synced", (event) => {
    const activity = useGatewayThreadActivityStore();
    const lastUserInput = lastUserInputFromTurn(event.turn);
    if (lastUserInput !== undefined) {
      activity.updateLastUserInput(event.hostId, event.threadId, lastUserInput);
    }
    const turnSummary = lastCompletedTurnSummaryFromTurn(event.turn);
    if (turnSummary !== undefined) {
      activity.updateTurnSummary(event.hostId, event.threadId, turnSummary);
    }
  });
  gatewayDomainEvents.on("history-agent-delta", (event) => {
    useGatewayThreadActivityStore().updateCurrentOperation(
      event.hostId,
      event.threadId,
      "Writing a response",
    );
  });
  gatewayDomainEvents.on("history-reasoning-summary-delta", (event) => {
    useGatewayThreadActivityStore().updateCurrentOperation(
      event.hostId,
      event.threadId,
      "Thinking through the change",
    );
  });
  gatewayDomainEvents.on("history-reasoning-text-delta", (event) => {
    useGatewayThreadActivityStore().updateCurrentOperation(
      event.hostId,
      event.threadId,
      "Thinking through the change",
    );
  });
  gatewayDomainEvents.on("history-plan-delta", (event) => {
    useGatewayThreadActivityStore().updateCurrentOperation(
      event.hostId,
      event.threadId,
      "Planning the next steps",
    );
  });
  gatewayDomainEvents.on("history-command-output-delta", (event) => {
    useGatewayThreadActivityStore().updateCurrentOperation(
      event.hostId,
      event.threadId,
      "Running a command",
    );
  });
}

function operationForHistoryItem(item: ThreadHistoryItem) {
  return operationForItem(item);
}
