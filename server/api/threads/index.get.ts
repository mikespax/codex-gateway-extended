import { getValidatedQuery } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { threadListSchema } from "../../utils/gateway/http/validation/threads";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { threadMetadataStore } from "../../utils/gateway/state/thread-metadata";
import { threadSnapshotStore } from "../../utils/gateway/state/thread-snapshots";
import { remoteFiles, threadStorage } from "../../utils/gateway/infra/host-services";
import { withAllThreadSources } from "../../utils/gateway/protocol/thread-list";
import { threadProjectDiscovery } from "../../utils/gateway/runtime/thread-project-discovery";
import type {
  AppServerThread,
  GatewayThread,
  ProjectDirectoryAvailability,
  ProjectRecord,
} from "~~/shared/types";
import type { HostWithSecret } from "../../utils/gateway/infra/ssh/ssh-types";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { gatewayThreadFromAppServer } from "../../utils/gateway/protocol/gateway-thread";
import { HOT_THREAD_LIST_LIMIT } from "~~/shared/config";

const PROJECT_DIRECTORY_AVAILABILITY_TTL_MS = 60_000;
interface ProjectDirectoryAvailabilityCacheEntry {
  fingerprint: string;
  updatedAt: number;
  value: Record<number, ProjectDirectoryAvailability>;
}

const projectDirectoryAvailabilityCache = new Map<string, ProjectDirectoryAvailabilityCacheEntry>();
const pendingProjectDirectoryAvailability = new Map<string, Promise<void>>();

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => threadListSchema.parse(body));
  const host = requireRecord(hostStore.getWithSecret(query.hostId), "Host not found");
  const userId = event.context.auth?.user.id;
  const searchTerm = trimmedOrNull(query.searchTerm);
  const historicalLookup = searchTerm !== null;
  const effectiveLimit = historicalLookup
    ? query.limit
    : Math.min(query.limit, HOT_THREAD_LIST_LIMIT);
  const discoveryGeneration =
    userId === undefined ? null : threadProjectDiscovery.captureGeneration(userId, host.id);
  setGatewayRequestLogContext(event, "threads/list", {
    ...hostLogContext(host),
    projectId: query.projectId ?? null,
    cwd: query.cwd ?? null,
    limit: effectiveLimit,
    cursor: query.cursor ?? null,
    searchTerm: searchTerm ?? null,
    useRemoteStateIndexOnly: query.useRemoteStateIndexOnly ?? false,
  });

  const listParams = withAllThreadSources({
    limit: effectiveLimit,
    cursor: trimmedOrNull(query.cursor),
    cwd: trimmedOrNull(query.cwd) ?? undefined,
    searchTerm: searchTerm ?? undefined,
    useStateDbOnly: query.useRemoteStateIndexOnly ?? false,
  });
  const page = await threadBroker.listThreads(host, listParams);
  if (userId !== undefined && discoveryGeneration !== null) {
    const current = threadProjectDiscovery.indexPageIfCurrent(
      userId,
      host.id,
      discoveryGeneration,
      page,
    );
    if (current && shouldDiscoverHostProjects(query)) {
      threadProjectDiscovery.schedule(userId, host, page, listParams, discoveryGeneration);
    }
  }
  const projects = projectStore.list(host.id);
  const indexedThreads = threadMetadataStore.list(host.id, {
    projectId: query.projectId ?? null,
    cwd: query.cwd ?? null,
  });
  const gatewayThreads = gatewayThreadsForList(
    host.id,
    page.data,
    threadSnapshotStore.listForHost(host.id).map((record) => record.snapshot.thread),
    indexedThreads,
    projects,
    searchTerm,
  );
  let threadsWithStorage = gatewayThreads;
  const cachedSizes = threadStorage.cached(host, gatewayThreads);
  threadsWithStorage = gatewayThreads.map((thread) => ({
    ...thread,
    threadBytes: cachedSizes.get(thread.id) ?? null,
  }));
  // Storage is advisory and must never delay an authoritative thread list. Refresh uncached
  // values in the background; the next sidebar refresh will pick them up.
  void threadStorage.scan(host, gatewayThreads).catch(() => undefined);
  const projectDirectoryAvailability = projectDirectoryAvailabilityForList(userId, host, projects);
  return {
    ...page,
    data: threadsWithStorage,
    projects,
    projectDirectoryAvailability,
  };
});

async function inspectProjectAvailability(
  host: HostWithSecret,
  projects: Array<{ id: number; remotePath: string }>,
) {
  try {
    const byPath = await remoteFiles.inspectProjectDirectories(
      host,
      projects.map((project) => project.remotePath),
    );
    return Object.fromEntries(
      projects.flatMap((project) => {
        const availability = byPath.get(project.remotePath.trim());
        return availability === undefined ? [] : [[project.id, availability]];
      }),
    );
  } catch (error) {
    // Availability is advisory; an SFTP outage must not hide projects or fail thread listing.
    console.warn("[gateway] project directory inspection failed", {
      hostId: host.id,
      hostName: host.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function projectDirectoryAvailabilityForList(
  userId: number | undefined,
  host: HostWithSecret,
  projects: Array<{ id: number; remotePath: string }>,
) {
  const key = `${userId ?? "anonymous"}:${host.id}`;
  const fingerprint = projects
    .map((project) => `${project.id}:${project.remotePath}`)
    .sort()
    .join("|");
  const cached = projectDirectoryAvailabilityCache.get(key);
  const cacheIsFresh =
    cached !== undefined &&
    cached.fingerprint === fingerprint &&
    Date.now() - cached.updatedAt < PROJECT_DIRECTORY_AVAILABILITY_TTL_MS;
  if (!cacheIsFresh && pendingProjectDirectoryAvailability.get(key) === undefined) {
    const pending = inspectProjectAvailability(host, projects)
      .then((availability) => {
        projectDirectoryAvailabilityCache.set(key, {
          fingerprint,
          updatedAt: Date.now(),
          value: availability,
        });
      })
      .catch((error: unknown) => {
        console.warn("[gateway] background project directory inspection failed", {
          hostId: host.id,
          hostName: host.name,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (pendingProjectDirectoryAvailability.get(key) === pending) {
          pendingProjectDirectoryAvailability.delete(key);
        }
      });
    pendingProjectDirectoryAvailability.set(key, pending);
  }
  return cached?.fingerprint === fingerprint ? cached.value : {};
}

function shouldDiscoverHostProjects(query: {
  projectId?: number | null;
  cwd?: string | null;
  searchTerm?: string | null;
  cursor?: string | null;
}) {
  // Historical project discovery is an explicit lookup operation. Normal sidebar refreshes only
  // index their bounded hot page; walking every older cursor competes with foreground thread RPCs.
  return trimmedOrNull(query.searchTerm) !== null;
}

function gatewayThreadsForList(
  hostId: number,
  remoteThreads: AppServerThread[],
  cachedThreads: AppServerThread[],
  indexedThreads: ReturnType<typeof threadMetadataStore.list>,
  projects: ProjectRecord[],
  searchTerm: string | null,
) {
  const metadataById = new Map(indexedThreads.map((thread) => [thread.id, thread]));
  const threadsById = new Map(remoteThreads.map((thread) => [thread.id, thread]));
  for (const thread of cachedThreads) {
    if (metadataById.has(thread.id) && !threadsById.has(thread.id)) {
      // A freshly started thread can precede rollout materialization and therefore be absent from
      // thread/list briefly. The open snapshot is the complete official DTO returned by
      // thread/start; never synthesize an AppServerThread from the metadata index.
      threadsById.set(thread.id, thread);
    }
  }
  const normalizedSearch = searchTerm?.trim().toLowerCase() ?? "";
  return [...threadsById.values()]
    .map((thread) => {
      const metadata = metadataById.get(thread.id);
      const projectId =
        metadata?.projectId ??
        projects.find((project) => project.remotePath === thread.cwd)?.id ??
        null;
      return gatewayThreadFromAppServer(hostId, projectId, thread);
    })
    .filter((thread) => {
      if (!normalizedSearch) {
        return true;
      }
      return [thread.id, thread.title, thread.name, thread.preview, thread.cwd]
        .filter((value): value is string => typeof value === "string")
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    })
    .sort(
      (left, right) =>
        Number(right.recencyAt ?? right.updatedAt ?? 0) -
        Number(left.recencyAt ?? left.updatedAt ?? 0),
    ) satisfies GatewayThread[];
}
