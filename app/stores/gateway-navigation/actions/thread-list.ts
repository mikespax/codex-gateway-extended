import { gatewayApi } from "@/utils/gateway-api";
import type { GatewayThread } from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import type { ThreadListResponse } from "@/stores/gateway/types";
import { messageFromError, sortThreads } from "@/stores/gateway/thread-utils/identity";
import { runtimeStatusFromAppThreadStatus } from "@/stores/gateway/thread-utils/status";
import { isAppServerSubAgentThread } from "~~/shared/runtime/app-server";
import { captureSessionEpoch } from "@/utils/session-epoch";

const THREAD_LIST_PAGE_LIMIT = 100;
const MAX_THREAD_LIST_PAGES = 20;

/**
 * The app-server keeps older threads behind cursors.  The gateway sidebar has
 * no separate "load older" control, so aggregate the bounded catalog here.
 * This makes pre-existing CLI/VS Code chats discoverable after adding a host.
 */
async function listAllThreads(
  query: Record<string, unknown>,
  sessionIsCurrent: () => boolean,
): Promise<ThreadListResponse | null> {
  const threadsById = new Map<string, GatewayThread>();
  let firstResponse: ThreadListResponse | null = null;
  let cursor: string | null = null;

  for (let page = 0; page < MAX_THREAD_LIST_PAGES; page += 1) {
    const response: ThreadListResponse = await gatewayApi<ThreadListResponse>("/api/threads", {
      query: cursor === null ? query : { ...query, cursor },
    });
    if (!sessionIsCurrent()) return null;
    firstResponse ??= response;
    for (const thread of response.data ?? []) threadsById.set(thread.id, thread);
    cursor = response.nextCursor ?? null;
    if (cursor === null) break;
  }

  return firstResponse === null ? null : { ...firstResponse, data: [...threadsById.values()] };
}

export function createThreadListActions() {
  async function loadHostOverview(hostId: number) {
    const catalog = useGatewayCatalogStore();
    const sessionIsCurrent = captureSessionEpoch();
    const response = await listAllThreads(
      { hostId, limit: THREAD_LIST_PAGE_LIMIT },
      sessionIsCurrent,
    );
    if (response === null) return false;
    if (response.projects !== undefined) catalog.mergeProjects(response.projects);
    applyProjectDirectoryAvailability(response);
    useGatewayThreadActivityStore().ingestGatewayThreads(response.data ?? [], catalog.projects);
    syncThreadStatusesFromList(hostId, response.data ?? []);
    return true;
  }

  return {
    async connectAllHosts() {
      const catalog = useGatewayCatalogStore();
      const config = useGatewayConfigStore();
      const bootstrap = useGatewayBootstrapStore();
      const sessionIsCurrent = captureSessionEpoch();
      await Promise.all(
        catalog.hosts.map(async (host) => {
          catalog.setHostConnectionStatus(host.id, "connecting");
          try {
            if (!(await loadHostOverview(host.id)) || !sessionIsCurrent()) return;
            catalog.setHostConnectionStatus(host.id, "connected");
          } catch (error: unknown) {
            if (!sessionIsCurrent()) return;
            catalog.setHostConnectionStatus(
              host.id,
              "failed",
              messageFromError(error, bootstrap.t("app.connectHostFailed"), bootstrap.errorLabels),
            );
          }
        }),
      );
      if (!sessionIsCurrent()) return;
      config.setCatalog(catalog.hosts, catalog.projects);
    },
    refreshHostProjects: loadHostOverview,
    async listThreads(searchTerm = "") {
      const catalog = useGatewayCatalogStore();
      const config = useGatewayConfigStore();
      const bootstrap = useGatewayBootstrapStore();
      const navigation = useGatewayNavigationStore();
      const views = useGatewayThreadViewStore();
      const hostId = navigation.selectedHostId;
      const projectId = navigation.selectedProjectId;
      const projectCwd = projectById(catalog.projects, projectId)?.remotePath;
      if (hostId === null) return;
      const sessionIsCurrent = captureSessionEpoch();
      views.loading = true;
      bootstrap.clearError();
      try {
        const query: Record<string, unknown> = { hostId, limit: THREAD_LIST_PAGE_LIMIT };
        if (projectId !== null) query.projectId = projectId;
        if (projectCwd !== undefined && projectCwd !== "") query.cwd = projectCwd;
        if (searchTerm !== "") query.searchTerm = searchTerm;
        const response = await listAllThreads(query, sessionIsCurrent);
        if (response === null) return;
        if (navigation.selectedHostId !== hostId || navigation.selectedProjectId !== projectId)
          return;
        if (response.projects !== undefined) catalog.mergeProjects(response.projects);
        applyProjectDirectoryAvailability(response);
        useGatewayThreadActivityStore().ingestGatewayThreads(response.data ?? [], catalog.projects);
        catalog.setHostConnectionStatus(hostId, "connected");
        syncThreadStatusesFromList(hostId, response.data ?? []);
        // Sub-agent threads remain addressable by their explicit panel links, but they are not
        // top-level navigation entries. Filter once at the catalog boundary so every sidebar
        // projection cannot accidentally reintroduce them with a slightly different predicate.
        const mainThreads = (response.data ?? []).filter(
          (thread) => !isAppServerSubAgentThread(thread),
        );
        // `/api/threads` is the sole AppServerThread -> GatewayThread boundary. Do not overlay
        // browser config here: doing so creates two pin authorities and makes cross-tab updates
        // dependent on which request happened last.
        navigation.threads = sortThreads(mainThreads);
        config.setCatalog(catalog.hosts, catalog.projects);
      } catch (error: unknown) {
        if (!sessionIsCurrent()) return;
        if (navigation.selectedHostId !== hostId || navigation.selectedProjectId !== projectId)
          return;
        const message = messageFromError(
          error,
          bootstrap.t("app.listThreadsFailed"),
          bootstrap.errorLabels,
        );
        catalog.setHostConnectionStatus(hostId, "failed", message);
        bootstrap.setError(message, { hostId, projectId, threadId: navigation.selectedThreadId });
      } finally {
        if (
          sessionIsCurrent() &&
          navigation.selectedHostId === hostId &&
          navigation.selectedProjectId === projectId
        ) {
          views.loading = false;
        }
      }
    },
  };
}

function applyProjectDirectoryAvailability(response: ThreadListResponse) {
  if (response.projectDirectoryAvailability === undefined) return;
  const catalog = useGatewayCatalogStore();
  catalog.projectDirectoryAvailability = {
    ...catalog.projectDirectoryAvailability,
    ...response.projectDirectoryAvailability,
  };
}

function syncThreadStatusesFromList(hostId: number, threads: GatewayThread[]) {
  const runtime = useGatewayThreadRuntimeStore();
  for (const thread of threads) {
    runtime.setThreadStatus(hostId, thread.id, runtimeStatusFromAppThreadStatus(thread.status));
  }
}
