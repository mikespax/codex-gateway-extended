import { storeToRefs } from "pinia";
import { computed } from "vue";
import type { PinnedThreadRecord } from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayPinnedThreads } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import {
  type ThreadActivitySummary,
  useGatewayThreadActivityStore,
} from "@/stores/gateway-thread-activity";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

export function useRecentThreadActivity() {
  const catalog = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const runtime = useGatewayThreadRuntimeStore();
  const threadView = useGatewayThreadViewStore();
  const activity = useGatewayThreadActivityStore();
  const { summariesByKey } = storeToRefs(activity);
  const { hosts } = storeToRefs(catalog);
  const pinnedThreads = useGatewayPinnedThreads();
  const { threadStatuses, unviewedCompletedThreadKeys } = storeToRefs(runtime);

  const recentThreads = computed(() => {
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const pinnedKeys = new Set(
      pinnedThreads.value.map((thread) => pinnedKey(thread.hostId, thread.threadId)),
    );
    const unviewedKeys = new Set(unviewedCompletedThreadKeys.value);
    return Object.values(summariesByKey.value)
      .filter(
        (thread): thread is ThreadActivitySummary =>
          // app-server parentThreadId is the authoritative sub-agent marker. Sub-agents stay in
          // their parent workspace rather than flooding the cross-host list.
          !thread.isSubAgent && recentDisplayActivityAt(thread) >= cutoff,
      )
      .map((thread) => ({
        ...thread,
        ...resolvedProjectFields(thread),
        id: thread.threadId,
        hostName: hosts.value.find((host) => host.id === thread.hostId)?.name ?? null,
        status: threadStatuses.value[keyFor(thread)] ?? "idle",
        completionAttention: unviewedKeys.has(keyFor(thread)),
        pinned: pinnedKeys.has(keyFor(thread)),
      }))
      .sort(compareRecentThreads);
  });

  function openRecentThread(thread: ThreadActivitySummary) {
    void threadView.openThread(thread.threadId, {
      hostId: thread.hostId,
      projectId: thread.projectId,
    });
  }

  function resolvedProjectFields(thread: ThreadActivitySummary) {
    const project = catalog.projects.find(
      (candidate) =>
        candidate.hostId === thread.hostId &&
        (candidate.id === thread.projectId || candidate.remotePath === thread.cwd),
    );
    return {
      projectId: project?.id ?? null,
      projectName: project?.name ?? thread.projectName,
    };
  }

  function pinRecentThread(thread: ThreadActivitySummary & { pinned: boolean }) {
    void navigation.setPinnedThread(toPinnedThread(thread), !thread.pinned);
  }

  return {
    recentThreads,
    openRecentThread,
    pinRecentThread,
  };
}

function recentDisplayActivityAt(thread: ThreadActivitySummary) {
  return typeof thread.completionAt === "number" && Number.isFinite(thread.completionAt)
    ? thread.completionAt
    : typeof thread.displayActivityAt === "number" && Number.isFinite(thread.displayActivityAt)
      ? thread.displayActivityAt
      : thread.updatedAt;
}

function compareRecentThreads(left: ThreadActivitySummary, right: ThreadActivitySummary) {
  const byActivity = recentDisplayActivityAt(right) - recentDisplayActivityAt(left);
  if (byActivity !== 0) return byActivity;
  const byHost = left.hostId - right.hostId;
  if (byHost !== 0) return byHost;
  return left.threadId.localeCompare(right.threadId);
}

function keyFor(thread: ThreadActivitySummary) {
  return pinnedKey(thread.hostId, thread.threadId);
}

function toPinnedThread(thread: ThreadActivitySummary): PinnedThreadRecord {
  return {
    hostId: thread.hostId,
    projectId: thread.projectId,
    threadId: thread.threadId,
    title: thread.title,
    subtitle: thread.cwd,
    projectName: thread.projectName,
    updatedAt: thread.updatedAt,
  };
}
