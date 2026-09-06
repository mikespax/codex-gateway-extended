import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useGatewayPinnedThreads } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";
import type { SidebarThreadRow } from "../sidebar-types";

export function useThreadRename() {
  const navigation = useGatewayNavigationStore();
  const pinnedThreads = useGatewayPinnedThreads();
  const { threads } = storeToRefs(navigation);
  const renameTarget = ref<{ hostId: number; threadId: string } | null>(null);
  const renameValue = ref("");
  const submitting = ref(false);
  const open = computed({
    get: () => renameTarget.value !== null,
    set: (value) => {
      if (!value) cancelRename();
    },
  });

  function startRename(thread: SidebarThreadRow) {
    const hostId = "hostId" in thread ? Number(thread.hostId) : Number(navigation.selectedHostId);
    const threadIdValue =
      "threadId" in thread &&
      (typeof thread.threadId === "string" || typeof thread.threadId === "number")
        ? thread.threadId
        : "id" in thread
          ? thread.id
          : null;
    const threadId = threadIdValue === null ? "" : String(threadIdValue);
    if (!hostId || !threadId) return;
    renameTarget.value = { hostId, threadId };
    renameValue.value = titleForThread(thread);
  }

  async function submitRename() {
    const target = renameTarget.value;
    const name = renameValue.value.trim();
    if (!target || !name) {
      cancelRename();
      return;
    }
    const thread =
      threads.value.find(
        (candidate) =>
          navigation.selectedHostId === target.hostId && String(candidate.id) === target.threadId,
      ) ||
      pinnedThreads.value.find(
        (candidate) =>
          candidate.hostId === target.hostId && String(candidate.threadId) === target.threadId,
      );
    if (thread && titleForThread(thread) === name) {
      cancelRename();
      return;
    }
    submitting.value = true;
    try {
      await navigation.renameThread(target.hostId, target.threadId, name);
      cancelRename();
    } finally {
      submitting.value = false;
    }
  }

  function cancelRename() {
    renameTarget.value = null;
    renameValue.value = "";
  }

  return {
    open,
    renameValue,
    submitting,
    startRename,
    submitRename,
  };
}
