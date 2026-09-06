import { storeToRefs } from "pinia";
import { computed } from "vue";
import type { GatewayThread, ThreadHistoryState } from "~~/shared/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";

export function useChatWorkspaceState() {
  const bootstrapRefs = storeToRefs(useGatewayBootstrapStore());
  const navigationRefs = storeToRefs(useGatewayNavigationStore());
  const runtime = useGatewayThreadRuntimeStore();
  const viewRefs = storeToRefs(useGatewayThreadViewStore());
  // The backend projects snapshot history once and realtime reducers update this Pinia array only
  // when data changes. A thread switch must select the cached reference, not rescan every item.
  const historyTurns = computed(() => viewRefs.timelineTurns.value);
  const selectedThreadViewReady = computed(() =>
    isSelectedThreadViewReady({
      selectedThreadId: navigationRefs.selectedThreadId.value,
      currentThread: viewRefs.currentThread.value,
      history: viewRefs.history.value,
    }),
  );
  const visibleError = computed(() =>
    scopedVisibleError({
      error: bootstrapRefs.error.value,
      selectedHostId: navigationRefs.selectedHostId.value,
      selectedProjectId: navigationRefs.selectedProjectId.value,
      selectedThreadId: navigationRefs.selectedThreadId.value,
    }),
  );
  return {
    ...bootstrapRefs,
    ...navigationRefs,
    ...viewRefs,
    historyTurns,
    threadItems: computed(() => historyTurns.value.flatMap((turn) => turn.items)),
    openingThread: computed(
      () =>
        navigationRefs.selectedThreadId.value !== null &&
        viewRefs.loading.value &&
        historyTurns.value.length === 0,
    ),
    selectedThreadStatus: computed(() => {
      const hostId = navigationRefs.selectedHostId.value;
      const threadId = navigationRefs.selectedThreadId.value;
      return hostId !== null && threadId !== null ? runtime.statusFor(hostId, threadId) : "idle";
    }),
    selectedThreadViewReady,
    visibleError,
    canOpenTerminal: computed(() => navigationRefs.selectedHostId.value !== null),
  };
}

function isSelectedThreadViewReady(input: {
  selectedThreadId: string | null;
  currentThread: GatewayThread | null;
  history: ThreadHistoryState | null;
}) {
  if (input.selectedThreadId === null) return true;
  return (
    input.currentThread?.id === input.selectedThreadId ||
    input.history?.thread.id === input.selectedThreadId
  );
}

function scopedVisibleError(input: {
  error: {
    message: string;
    hostId: number | null;
    projectId: number | null;
    threadId: string | null;
  } | null;
  selectedHostId: number | null;
  selectedProjectId: number | null;
  selectedThreadId: string | null;
}) {
  const current = input.error;
  if (!current) return null;
  if (current.hostId !== null && current.hostId !== input.selectedHostId) return null;
  if (current.projectId !== null && current.projectId !== input.selectedProjectId) return null;
  if (current.threadId !== null && current.threadId !== input.selectedThreadId) return null;
  return current.message;
}
