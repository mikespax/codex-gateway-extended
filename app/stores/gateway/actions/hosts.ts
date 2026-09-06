import type { HostRecord } from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import { gatewayDomainEvents } from "../domain-events";
import { writeGatewayRouteSelection } from "../route-state";
import { beginViewTransition, cacheSelectedThreadView } from "../thread-open/view-state";
import { captureSessionEpoch } from "@/utils/session-epoch";

export function createHostActions() {
  function selectHostState(hostId: number | null) {
    const catalog = useGatewayCatalogStore();
    const navigation = useGatewayNavigationStore();
    const views = useGatewayThreadViewStore();
    beginViewTransition();
    navigation.selectedHostId = hostId;
    navigation.selectedProjectId = null;
    navigation.selectedThreadId = null;
    navigation.threads = [];
    views.resetCurrentView();
    catalog.models = [];
    catalog.modelsHostId = null;
    useGatewayBootstrapStore().clearError();
  }

  return {
    async createHost(input: Record<string, unknown>) {
      const sessionIsCurrent = captureSessionEpoch();
      const catalog = useGatewayCatalogStore();
      const config = useGatewayConfigStore();
      const navigation = useGatewayNavigationStore();
      const host = await gatewayApi<HostRecord>("/api/hosts", { method: "POST", body: input });
      if (!sessionIsCurrent()) return host;
      catalog.hosts.push(host);
      config.setCatalog(catalog.hosts, catalog.projects);
      selectHostState(host.id);
      writeGatewayRouteSelection({ hostId: host.id, projectId: null, threadId: null });
      await Promise.all([catalog.listModels(), navigation.listThreads()]);
      catalog.ensureSelectedProject();
      if (navigation.selectedProjectId !== null) await navigation.listThreads();
      return host;
    },

    async updateHost(hostId: number, input: Record<string, unknown>) {
      const sessionIsCurrent = captureSessionEpoch();
      const catalog = useGatewayCatalogStore();
      const host = await gatewayApi<HostRecord>(`/api/hosts/${hostId}`, {
        method: "PATCH",
        body: input,
      });
      if (!sessionIsCurrent()) return host;
      catalog.hosts = catalog.hosts.map((candidate) =>
        candidate.id === hostId ? host : candidate,
      );
      useGatewayConfigStore().setCatalog(catalog.hosts, catalog.projects);
      return host;
    },

    async deleteHost(hostId: number) {
      const sessionIsCurrent = captureSessionEpoch();
      const catalog = useGatewayCatalogStore();
      const config = useGatewayConfigStore();
      const navigation = useGatewayNavigationStore();
      await gatewayApi(`/api/hosts/${hostId}`, { method: "DELETE" });
      if (!sessionIsCurrent()) return;
      gatewayDomainEvents.emit("host-removed", { hostId });
      useGatewayTmuxStore().removeHost(hostId);
      catalog.hosts = catalog.hosts.filter((host) => host.id !== hostId);
      const removedProjectIds = new Set(
        catalog.projects
          .filter((project) => project.hostId === hostId)
          .map((project) => project.id),
      );
      catalog.projects = catalog.projects.filter((project) => project.hostId !== hostId);
      catalog.projectDirectoryAvailability = Object.fromEntries(
        Object.entries(catalog.projectDirectoryAvailability).filter(
          ([projectId]) => !removedProjectIds.has(Number(projectId)),
        ),
      );
      config.gatewayConfig.projects = config.gatewayConfig.projects.filter(
        (project) => project.hostId !== hostId,
      );
      catalog.hostConnectionStatuses = omitKey(catalog.hostConnectionStatuses, hostId);
      config.gatewayConfig.pinnedThreads = config.gatewayConfig.pinnedThreads.filter(
        (thread) => thread.hostId !== hostId,
      );
      config.setCatalog(catalog.hosts, catalog.projects);
      if (navigation.selectedHostId === hostId) {
        selectHostState(catalog.hosts[0]?.id ?? null);
        writeGatewayRouteSelection(
          { hostId: navigation.selectedHostId, projectId: null, threadId: null },
          { replace: true },
        );
        if (navigation.selectedHostId) {
          await catalog.listModels();
          await navigation.listThreads();
        }
      }
    },

    async selectHost(hostId: number) {
      const catalog = useGatewayCatalogStore();
      const navigation = useGatewayNavigationStore();
      cacheSelectedThreadView();
      selectHostState(hostId);
      writeGatewayRouteSelection({ hostId, projectId: null, threadId: null });
      await catalog.listModels();
      await navigation.listThreads();
      catalog.ensureSelectedProject();
      if (navigation.selectedProjectId !== null) await navigation.listThreads();
    },
  };
}

function omitKey<T>(record: Record<number, T>, key: number) {
  const { [key]: _removed, ...remaining } = record;
  return remaining;
}
