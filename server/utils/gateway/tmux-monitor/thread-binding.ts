import type { TmuxMonitorThreadBinding } from "~~/shared/types";
import { gatewayMemoryState } from "../state/memory";
import { threadMetadataStore } from "../state/thread-metadata";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export function resolveTmuxThreadBinding(
  hostId: number,
  requested: TmuxMonitorThreadBinding | null | undefined,
): TmuxMonitorThreadBinding | null {
  if (requested === null || requested === undefined) return null;
  const metadata = threadMetadataStore.get(hostId, requested.threadId);
  const pinned = gatewayMemoryState.pinnedThreads.find(
    (thread) => thread.hostId === hostId && thread.threadId === requested.threadId,
  );
  return {
    projectId: metadata?.projectId ?? pinned?.projectId ?? requested.projectId,
    threadId: requested.threadId,
    threadTitle:
      firstNonEmptyString([
        metadata?.title,
        metadata?.name,
        metadata?.preview,
        pinned?.title,
        requested.threadTitle,
      ]) ?? requested.threadId,
  };
}
