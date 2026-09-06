import { storeToRefs } from "pinia";
import { computed } from "vue";
import type { TmuxMonitorThreadBinding } from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export function useTmuxMonitorDashboard() {
  const gateway = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const activity = useGatewayThreadActivityStore();
  const { hosts } = storeToRefs(gateway);
  const { summariesByKey } = storeToRefs(activity);

  const hostNames = computed(() =>
    Object.fromEntries(
      hosts.value.map((host) => [host.id, firstNonEmptyString([host.name, host.sshHost]) ?? ""]),
    ),
  );

  function currentThreadBindingForHost(hostId: number): TmuxMonitorThreadBinding | null {
    if (navigation.selectedHostId !== hostId || navigation.selectedThreadId === null) return null;
    const summary = Object.values(summariesByKey.value).find(
      (candidate) =>
        candidate.hostId === hostId && candidate.threadId === navigation.selectedThreadId,
    );
    return {
      projectId: summary?.projectId ?? navigation.selectedProjectId,
      threadId: navigation.selectedThreadId,
      threadTitle: firstNonEmptyString([summary?.title, navigation.selectedThreadId]) ?? "",
    };
  }

  return {
    hosts,
    hostNames,
    currentHostId: computed(() => navigation.selectedHostId),
    currentThreadBindingForHost,
  };
}
