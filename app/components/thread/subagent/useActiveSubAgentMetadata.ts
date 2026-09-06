import { watchDebounced } from "@vueuse/core";
import type { MaybeRefOrGetter } from "vue";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import {
  useGatewayThreadActivityStore,
  type ThreadActivityMetadata,
} from "@/stores/gateway-thread-activity";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { gatewayApi } from "@/utils/gateway-api";
import { captureSessionEpoch } from "@/utils/session-epoch";
import type { ActiveSubAgent } from "./active-subagents";

interface ThreadMetadataResponse {
  data: ThreadActivityMetadata[];
}

export function useActiveSubAgentMetadata(
  hostId: MaybeRefOrGetter<number | null>,
  agents: MaybeRefOrGetter<ActiveSubAgent[]>,
) {
  const activity = useGatewayThreadActivityStore();
  const catalog = useGatewayCatalogStore();
  const requested = new Set<string>();
  const unresolved = computed(() => {
    const currentHostId = toValue(hostId);
    if (currentHostId === null) return [];
    return toValue(agents)
      .map((agent) => agent.threadId)
      .filter((threadId) => {
        const summary = activity.summariesByKey[pinnedKey(currentHostId, threadId)];
        return summary?.agentNickname === null || summary?.agentNickname === undefined;
      });
  });

  watchDebounced(
    () => [toValue(hostId), unresolved.value.join(",")] as const,
    ([currentHostId, signature]) => {
      if (currentHostId === null || signature === "") return;
      const requestKey = `${currentHostId}:${signature}`;
      if (requested.has(requestKey)) return;
      requested.add(requestKey);
      const sessionIsCurrent = captureSessionEpoch();
      void gatewayApi<ThreadMetadataResponse>("/api/threads/metadata", {
        query: { hostId: currentHostId, threadIds: signature },
      })
        .then((response) => {
          if (sessionIsCurrent())
            activity.ingestMetadata(currentHostId, response.data, catalog.projects);
        })
        .catch(() => {
          // Metadata is advisory. A later activity update/remount can retry; the Agent timeline and
          // sub-agent panel remain fully functional with their localized fallback title.
          requested.delete(requestKey);
        });
    },
    { debounce: 100, immediate: true },
  );
}
