import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { gatewayDomainEvents } from "../domain-events";
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
}
