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
import type { AppServerThread, GatewayThread, ProjectRecord } from "~~/shared/types";
import type { HostWithSecret } from "../../utils/gateway/infra/ssh/ssh-types";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { gatewayThreadFromAppServer } from "../../utils/gateway/protocol/gateway-thread";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => threadListSchema.parse(body));
  const host = requireRecord(hostStore.getWithSecret(query.hostId), "Host not found");
  const userId = event.context.auth?.user.id;
  const discoveryGeneration =
    userId === undefined ? null : threadProjectDiscovery.captureGeneration(userId, host.id);
  setGatewayRequestLogContext(event, "threads/list", {
    ...hostLogContext(host),
    projectId: query.projectId ?? null,
    cwd: query.cwd ?? null,
    limit: query.limit,
    cursor: query.cursor ?? null,
    searchTerm: query.searchTerm ?? null,
    useRemoteStateIndexOnly: query.useRemoteStateIndexOnly ?? false,
  });

  const listParams = withAllThreadSources({
    limit: query.limit,
    cursor: trimmedOrNull(query.cursor),
    cwd: trimmedOrNull(query.cwd) ?? undefined,
    searchTerm: trimmedOrNull(query.searchTerm) ?? undefined,
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
    query.searchTerm ?? null,
  );
  let threadsWithStorage = gatewayThreads;
  try {
    const sizes = await threadStorage.scan(host, gatewayThreads);
    threadsWithStorage = gatewayThreads.map((thread) => ({
      ...thread,
      threadBytes: sizes.get(thread.id) ?? null,
    }));
  } catch {
    // Storage is advisory. A missing rollout, unsupported remote utility, or SSH outage must not
    // hide otherwise authoritative threads from the list.
  }
  const projectDirectoryAvailability = await inspectProjectAvailability(host, projects);
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

function shouldDiscoverHostProjects(query: {
  projectId?: number | null;
  cwd?: string | null;
  searchTerm?: string | null;
  cursor?: string | null;
}) {
  return (
    (query.projectId === null || query.projectId === undefined) &&
    trimmedOrNull(query.cwd) === null &&
    trimmedOrNull(query.searchTerm) === null &&
    trimmedOrNull(query.cursor) === null
  );
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
