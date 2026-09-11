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
import { HOT_THREAD_LIST_LIMIT } from "~~/shared/config";
import { captureSessionEpoch } from "@/utils/session-epoch";

const THREAD_LIST_PAGE_LIMIT = 100;
const MAX_THREAD_LIST_PAGES = 20;
const THREAD_STORAGE_REFRESH_DELAYS_MS = [750, 1_500, 3_000, 6_000, 12_000] as const;

/**
 * Keep the normal sidebar path focused on the user's hot set. Older threads remain addressable by
 * their pinned IDs and by explicit search, which is the only path that should walk the full cursor
 * chain and populate the historical project index.
 */
async function listAllThreads(
  query: Record<string, unknown>,
  sessionIsCurrent: () => boolean,
  options: { allPages?: boolean } = {},
): Promise<ThreadListResponse | null> {
  const allPages = options.allPages === true;
  const limit = allPages ? THREAD_LIST_PAGE_LIMIT : HOT_THREAD_LIST_LIMIT;
  const threadsById = new Map<string, GatewayThread>();
  let firstResponse: ThreadListResponse | null = null;
  let cursor: string | null = null;

  for (let page = 0; page < (allPages ? MAX_THREAD_LIST_PAGES : 1); page += 1) {
    const requestQuery = { ...query, limit };
    const response: ThreadListResponse = await gatewayApi<ThreadListResponse>("/api/threads", {
      query: cursor === null ? requestQuery : { ...requestQuery, cursor },
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
  const storageRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const storageRefreshAttempts = new Map<number, number>();

  function cancelStorageRefresh(hostId: number) {
    const timer = storageRefreshTimers.get(hostId);
    if (timer !== undefined) clearTimeout(timer);
    storageRefreshTimers.delete(hostId);
    storageRefreshAttempts.delete(hostId);
  }

  function scheduleStorageRefresh(hostId: number, pending: boolean | undefined) {
    if (pending !== true) {
      cancelStorageRefresh(hostId);
      return;
    }
    if (storageRefreshTimers.has(hostId)) return;
    const attempt = storageRefreshAttempts.get(hostId) ?? 0;
    const delay = THREAD_STORAGE_REFRESH_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      storageRefreshTimers.delete(hostId);
      storageRefreshAttempts.set(hostId, attempt + 1);
      const catalog = useGatewayCatalogStore();
      const navigation = useGatewayNavigationStore();
      if (!catalog.hosts.some((host) => host.id === hostId)) {
        cancelStorageRefresh(hostId);
        return;
      }
      // A selected host needs the navigation catalog refreshed as well as the activity summaries;
      // an unselected host only needs its pinned/recent summaries updated.
      const refresh =
        navigation.selectedHostId === hostId ? navigation.listThreads() : loadHostOverview(hostId);
      void refresh.catch(() => undefined);
    }, delay);
    storageRefreshTimers.set(hostId, timer);
  }

  async function loadHostOverview(hostId: number) {
    const catalog = useGatewayCatalogStore();
    const sessionIsCurrent = captureSessionEpoch();
    const response = await listAllThreads({ hostId }, sessionIsCurrent);
    if (response === null) return false;
    if (response.projects !== undefined) catalog.mergeProjects(response.projects);
    applyProjectDirectoryAvailability(response);
    useGatewayThreadActivityStore().ingestGatewayThreads(response.data ?? [], catalog.projects);
    syncThreadStatusesFromList(hostId, response.data ?? []);
    scheduleStorageRefresh(hostId, response.threadStoragePending);
    return true;
  }

  /** Load the bounded cross-host catalog only after the user asks to see Recent chats. */
  async function loadRecentThreads() {
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
    if (sessionIsCurrent()) config.setCatalog(catalog.hosts, catalog.projects);
  }

  return {
    connectAllHosts: loadRecentThreads,
    loadRecentThreads,
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
        const searchMode = searchTerm.trim() !== "";
        const query: Record<string, unknown> = { hostId };
        if (projectId !== null) query.projectId = projectId;
        if (projectCwd !== undefined && projectCwd !== "") query.cwd = projectCwd;
        if (searchTerm !== "") query.searchTerm = searchTerm;
        const response = await listAllThreads(query, sessionIsCurrent, { allPages: searchMode });
        if (response === null) return;
        if (navigation.selectedHostId !== hostId || navigation.selectedProjectId !== projectId)
          return;
        if (response.projects !== undefined) catalog.mergeProjects(response.projects);
        applyProjectDirectoryAvailability(response);
        useGatewayThreadActivityStore().ingestGatewayThreads(response.data ?? [], catalog.projects);
        catalog.setHostConnectionStatus(hostId, "connected");
        syncThreadStatusesFromList(hostId, response.data ?? []);
        scheduleStorageRefresh(hostId, response.threadStoragePending);
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
  const activity = useGatewayThreadActivityStore();
  for (const thread of threads) {
    const status = runtimeStatusFromAppThreadStatus(thread.status);
    runtime.setThreadStatus(hostId, thread.id, status);
    if (status === "running") activity.markTurnRunning(hostId, thread.id);
    else activity.updateCurrentOperation(hostId, thread.id, null);
  }
}
