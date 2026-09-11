import type { GatewayConfig } from "~~/shared/types";
import { normalizeNotificationSettings, normalizeProviderRouting } from "~~/shared/config";
import { gatewayEventStore } from "./gateway-events";
import { gatewayMemoryState } from "./memory";
import { normalizePinnedThreads } from "./memory";
import { hostStore } from "./hosts";
import { projectStore } from "./projects";
import { subAgentThreadStore } from "./sub-agent-threads";
import { threadMetadataStore } from "./thread-metadata";
import { threadSnapshotStore } from "./thread-snapshots";
import { getProviderRouterState, updateProviderRouterState } from "../provider-router/state";

export const runtimeConfigStore = {
  replace(config: GatewayConfig) {
    hostStore.replaceHosts(config.hosts);
    projectStore.replaceProjects(config.projects ?? []);
    const hostIds = hostStore.hostIds();
    projectStore.pruneToHosts(hostIds);
    threadMetadataStore.pruneToHosts(hostIds);
    threadSnapshotStore.pruneToHosts(hostIds);
    subAgentThreadStore.pruneToHosts(hostIds);
    gatewayEventStore.pruneToHosts(hostIds);
    gatewayMemoryState.pinnedThreads = normalizePinnedThreads(config.pinnedThreads ?? []).filter(
      (thread) => hostIds.has(thread.hostId),
    );
    gatewayMemoryState.notifications = normalizeNotificationSettings(config.notifications);
    gatewayMemoryState.providerRouting = normalizeProviderRouting(config.providerRouting);
    updateProviderRouterState((state) => {
      state.settings = normalizeProviderRouting(config.providerRouting);
    });
  },

  replacePinnedThreads(pinnedThreads: GatewayConfig["pinnedThreads"]) {
    const hostIds = hostStore.hostIds();
    gatewayMemoryState.pinnedThreads = normalizePinnedThreads(pinnedThreads).filter((thread) =>
      hostIds.has(thread.hostId),
    );
  },

  replaceNotifications(notifications: GatewayConfig["notifications"]) {
    gatewayMemoryState.notifications = normalizeNotificationSettings(notifications);
  },

  replaceProviderRouting(providerRouting: NonNullable<GatewayConfig["providerRouting"]>) {
    gatewayMemoryState.providerRouting = normalizeProviderRouting(providerRouting);
    updateProviderRouterState((state) => {
      state.settings = normalizeProviderRouting(providerRouting);
    });
  },

  export(): GatewayConfig {
    return {
      version: 1,
      hosts: hostStore.listWithSecret().map((host) => ({
        ...host,
        hasPassword: Boolean(host.password),
      })),
      projects: projectStore.listConfigured(),
      pinnedThreads: gatewayMemoryState.pinnedThreads,
      notifications: normalizeNotificationSettings(gatewayMemoryState.notifications),
      providerRouting: normalizeProviderRouting(
        getProviderRouterState().settings ?? gatewayMemoryState.providerRouting,
      ),
    };
  },

  counts() {
    return {
      hosts: hostStore.count(),
      projects: projectStore.count(),
    };
  },
};
