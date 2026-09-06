import { tryOnScopeDispose, useDocumentVisibility, useElementVisibility } from "@vueuse/core";
import type { Ref } from "vue";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";

export function useTmuxSessionSubscriptions(
  root: Ref<HTMLElement | null>,
  expandedHostIds: Ref<Set<number>>,
) {
  const realtime = useGatewayRealtimeStore();
  const tmux = useGatewayTmuxStore();
  const elementVisible = useElementVisibility(root);
  const documentVisibility = useDocumentVisibility();
  const subscribed = new Set<number>();

  const desiredHostIds = computed(() => {
    if (!elementVisible.value || documentVisibility.value !== "visible" || !realtime.connected)
      return [];
    return [...expandedHostIds.value].sort((left, right) => left - right);
  });

  watch(
    desiredHostIds,
    (desired) => {
      const desiredSet = new Set(desired);
      for (const hostId of subscribed) {
        if (desiredSet.has(hostId)) continue;
        tmux.unsubscribeSessions(hostId);
        subscribed.delete(hostId);
      }
      for (const hostId of desired) {
        if (subscribed.has(hostId)) continue;
        subscribed.add(hostId);
        void tmux.subscribeSessions(hostId);
      }
    },
    { immediate: true },
  );

  tryOnScopeDispose(() => {
    for (const hostId of subscribed) tmux.unsubscribeSessions(hostId);
    subscribed.clear();
  });
}
