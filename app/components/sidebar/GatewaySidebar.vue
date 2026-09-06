<script setup lang="ts">
import { ChevronDownIcon, SettingsIcon } from "@lucide/vue";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import SettingsPanel from "@/components/settings/SettingsPanel.vue";
import BrowserOpenDialog from "@/components/browser/BrowserOpenDialog.vue";
import { useLongPressContextMenu } from "@/composables/interactions/useLongPressContextMenu";
import { useWorkspaceLaunchActions } from "@/composables/workspace/useWorkspaceLaunchActions";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import AddProjectDialog from "./AddProjectDialog.vue";
import HostTree from "./host-tree/HostTree.vue";
import PinnedThreadList from "./thread-list/PinnedThreadList.vue";
import RecentThreadList from "./thread-list/RecentThreadList.vue";
import ThreadRenameDialog from "./thread-list/ThreadRenameDialog.vue";
import ThreadMoveDialog from "./thread-list/ThreadMoveDialog.vue";
import SidebarScrollArea from "./SidebarScrollArea.vue";
import { SidebarFooter } from "@codex-gateway/ui/sidebar";
import { useSidebarTree } from "./host-tree/useSidebarTree";
import { useThreadRename } from "./thread-list/useThreadRename";
import { useRecentThreadActivity } from "./thread-list/useRecentThreadActivity";
import SidebarWorkspaceToolbar from "./SidebarWorkspaceToolbar.vue";
import { useTmuxMonitorLauncher } from "@/composables/workspace/useTmuxMonitorLauncher";
import { useSidebarHostMetrics } from "@/composables/host-metrics/useSidebarHostMetrics";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import type { HostTreeController } from "./host-tree/controller";
import type { HostRecord, PinnedThreadRecord, ProjectRecord } from "./sidebar-types";
import { pinnedThreadKey } from "./sidebar-utils";
import { selectNewThreadProject } from "./new-thread-target";
import { gatewayApi } from "@/utils/gateway-api";
import {
  errorMessageLabels,
  messageFromError,
  titleForThread,
} from "@/stores/gateway/thread-utils/identity";
import type { ThreadMoveResult, ThreadNativeMigrationResult } from "~~/shared/types";

const PINNED_GROUPS_KEY = "codex-gateway-pinned-groups";
const SIDEBAR_SECTIONS_KEY = "codex-gateway-sidebar-sections";

type ThreadMoveSourceInput = {
  hostId: number;
  projectId?: number | null;
  threadId?: string | number;
  id?: string | number;
  title?: string | null;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
};

type ThreadMoveSource = {
  hostId: number;
  projectId: number | null;
  threadId: string;
  title: string;
  sourceCwd: string | null;
};

const catalog = useGatewayCatalogStore();
const threadActivity = useGatewayThreadActivityStore();
const config = useGatewayConfigStore();
const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
withDefaults(defineProps<{ workspaceToolbar?: boolean }>(), { workspaceToolbar: true });
const { t } = useI18n();
const showSettings = ref(false);
const showBrowserDialog = ref(false);
const projectEditor = ref<{ host: HostRecord; project: ProjectRecord | null } | null>(null);
const threadMove = ref<ThreadMoveSource | null>(null);
const threadMoveSubmitting = ref(false);
const threadMoveError = ref("");
const { longPressTriggered, longPressContextMenuHandlers } = useLongPressContextMenu();
const sidebarTree = useSidebarTree(longPressTriggered);
const threadRename = useThreadRename();
const recentActivity = useRecentThreadActivity();
const workspaceActions = useWorkspaceLaunchActions();
const tmuxLauncher = useTmuxMonitorLauncher();
const {
  hosts,
  pinnedThreads,
  selectedHostId,
  selectedProjectId,
  selectedThreadId,
  openPinnedThread,
  pinnedRuntimeStatus,
  pinnedCompletionAttention,
} = sidebarTree;
const { recentThreads } = recentActivity;
const { summariesByKey } = storeToRefs(threadActivity);
const { selectedHostTitle, canLaunch } = workspaceActions;
const { usageForHost } = useSidebarHostMetrics(hosts);
const { activeCount: tmuxActiveCount } = tmuxLauncher;
const errorLabels = computed(() => errorMessageLabels(t));
const inactivePinnedKeys = ref<Record<string, boolean>>({});
const activePinnedExpanded = ref(true);
const inactivePinnedExpanded = ref(false);
const recentChatsExpanded = ref(true);
const hostsExpanded = ref(true);
let migratingLegacyPinnedGroups = false;
const inactivePinnedThreads = computed(() =>
  pinnedThreads.value.filter((thread) => isInactivePinnedThread(thread)),
);
const activePinnedThreads = computed(() =>
  pinnedThreads.value.filter((thread) => !isInactivePinnedThread(thread)),
);
const hostTreeController = computed<HostTreeController>(() => ({
  hosts: sidebarTree.hosts.value,
  availableProjectsByHost: sidebarTree.availableProjectsByHost.value,
  missingProjectsByHost: sidebarTree.missingProjectsByHost.value,
  projectThreads: sidebarTree.projectThreads.value,
  expandedHostIds: sidebarTree.expandedHostIds.value,
  expandedProjectIds: sidebarTree.expandedProjectIds.value,
  expandedMissingProjectHostIds: sidebarTree.expandedMissingProjectHostIds.value,
  selectedHostId: sidebarTree.selectedHostId.value,
  selectedProjectId: sidebarTree.selectedProjectId.value,
  selectedThreadId: sidebarTree.selectedThreadId.value,
  hostConnectionStatuses: sidebarTree.hostConnectionStatuses.value,
  longPressHandlers: longPressContextMenuHandlers,
  selectHost: sidebarTree.selectHost,
  addProject: openAddProject,
  deleteHost: catalog.deleteHost,
  monitorHost: openHostMonitor,
  selectProject: sidebarTree.selectProject,
  toggleMissingProjects: sidebarTree.toggleMissingProjects,
  editProject: openEditProject,
  deleteProject: catalog.deleteProject,
  startThreadInProject: sidebarTree.startThreadInProject,
  openThread: sidebarTree.openThread,
  toggleThreadPin: navigation.setThreadPinned,
  rename: threadRename.startRename,
  threadRuntimeStatus: sidebarTree.threadRuntimeStatus,
  threadCompletionAttention: sidebarTree.threadCompletionAttention,
  hostResourceUsage: usageForHost,
  canMoveThreadToHost: hosts.value.length > 1,
  moveThread: requestThreadMove,
}));

function persistSidebarSections() {
  localStorage.setItem(
    SIDEBAR_SECTIONS_KEY,
    JSON.stringify({
      activePinnedExpanded: activePinnedExpanded.value,
      inactivePinnedExpanded: inactivePinnedExpanded.value,
      recentChatsExpanded: recentChatsExpanded.value,
      hostsExpanded: hostsExpanded.value,
    }),
  );
}

function isInactivePinnedThread(thread: PinnedThreadRecord) {
  return thread.inactive === true || inactivePinnedKeys.value[pinnedThreadKey(thread)] === true;
}

async function movePinnedThread(thread: PinnedThreadRecord, inactive: boolean) {
  try {
    await config.setPinnedThreadInactive(thread, inactive);
  } catch (error) {
    console.warn("[gateway] failed to update pinned thread group", error);
  }
}

function requestThreadMove(thread: ThreadMoveSourceInput) {
  const threadId =
    thread.threadId !== undefined
      ? String(thread.threadId)
      : thread.id !== undefined
        ? String(thread.id)
        : "";
  if (threadId === "") return;
  threadMoveError.value = "";
  threadMove.value = {
    hostId: thread.hostId,
    projectId: thread.projectId ?? null,
    threadId,
    title: titleForThread(thread),
    sourceCwd: typeof thread.cwd === "string" ? thread.cwd : null,
  };
}

async function submitThreadMove(input: {
  mode: "handoff" | "native";
  targetHostId: number;
  targetProjectId: number | null;
  targetCwd: string | null;
}) {
  const source = threadMove.value;
  if (source === null) return;
  threadMoveSubmitting.value = true;
  threadMoveError.value = "";
  try {
    if (input.mode === "native") {
      const result = await gatewayApi<ThreadNativeMigrationResult>("/api/threads/migrate", {
        method: "POST",
        body: {
          sourceHostId: source.hostId,
          sourceThreadId: source.threadId,
          targetHostId: input.targetHostId,
          targetCwd: input.targetCwd,
        },
      });
      const targetProject = catalog.projects.find(
        (project) =>
          project.hostId === result.target.hostId &&
          (project.id === input.targetProjectId || project.remotePath === result.target.cwd),
      );
      const targetHost = hosts.value.find((host) => host.id === result.target.hostId);
      try {
        await config.setPinnedThread(
          {
            hostId: result.target.hostId,
            projectId: targetProject?.id ?? null,
            threadId: result.target.threadId,
            title: source.title,
            subtitle: result.target.cwd,
            projectName: targetProject?.name ?? null,
            updatedAt: Math.floor(Date.now() / 1000),
          },
          true,
        );
      } catch (error) {
        // The migration is already committed by the server. A pin-sync failure must not make the
        // user retry the operation and repeat a native transfer with the same thread ID.
        console.warn("[gateway] migrated thread could not be pinned", {
          targetHostId: result.target.hostId,
          targetThreadId: result.target.threadId,
          error,
        });
      }
      threadMove.value = null;
      await threadView.openThread(result.target.threadId, {
        hostId: result.target.hostId,
        projectId: targetProject?.id ?? null,
      });
      if (targetHost !== undefined) {
        catalog.setHostConnectionStatus(targetHost.id, "connected");
      }
      return;
    }

    const result = await gatewayApi<ThreadMoveResult>("/api/threads/move", {
      method: "POST",
      body: {
        sourceHostId: source.hostId,
        sourceProjectId: source.projectId,
        sourceThreadId: source.threadId,
        targetHostId: input.targetHostId,
        targetProjectId: input.targetProjectId,
        targetCwd: input.targetCwd,
      },
    });
    const targetProject = catalog.projects.find(
      (project) => project.id === result.target.projectId,
    );
    const targetHost = hosts.value.find((host) => host.id === result.target.hostId);
    try {
      await config.setPinnedThread(
        {
          hostId: result.target.hostId,
          projectId: result.target.projectId,
          threadId: result.target.threadId,
          title: result.target.title,
          subtitle: result.target.cwd,
          projectName: targetProject?.name ?? null,
          updatedAt: Math.floor(Date.now() / 1000),
        },
        true,
      );
    } catch (error) {
      // The move itself is already committed by the server. A pin-sync failure must not make the
      // user retry the operation and create a duplicate target thread.
      console.warn("[gateway] moved thread could not be pinned", {
        targetHostId: result.target.hostId,
        targetThreadId: result.target.threadId,
        error,
      });
    }
    threadMove.value = null;
    await threadView.openThread(result.target.threadId, {
      hostId: result.target.hostId,
      projectId: result.target.projectId,
    });
    if (targetHost !== undefined) {
      catalog.setHostConnectionStatus(targetHost.id, "connected");
    }
  } catch (error: unknown) {
    threadMoveError.value = messageFromError(error, t("app.moveThreadFailed"), errorLabels.value);
  } finally {
    threadMoveSubmitting.value = false;
  }
}

function closeThreadMove(open: boolean) {
  if (!open && !threadMoveSubmitting.value) {
    threadMove.value = null;
    threadMoveError.value = "";
  }
}

onMounted(() => {
  try {
    inactivePinnedKeys.value = JSON.parse(localStorage.getItem(PINNED_GROUPS_KEY) ?? "{}") ?? {};
    const sections = JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) ?? "null");
    if (sections && typeof sections === "object") {
      if (typeof sections.activePinnedExpanded === "boolean")
        activePinnedExpanded.value = sections.activePinnedExpanded;
      if (typeof sections.inactivePinnedExpanded === "boolean")
        inactivePinnedExpanded.value = sections.inactivePinnedExpanded;
      if (typeof sections.recentChatsExpanded === "boolean")
        recentChatsExpanded.value = sections.recentChatsExpanded;
      if (typeof sections.hostsExpanded === "boolean") hostsExpanded.value = sections.hostsExpanded;
    }
    if (pinnedThreads.value.length > 0) void migrateLegacyPinnedGroups();
  } catch {
    inactivePinnedKeys.value = {};
  }
});

watch(
  pinnedThreads,
  (threads) => {
    // Bootstrap loads the server config after the layout mounts. Wait for that first non-empty
    // projection before migrating the old per-device grouping, otherwise a mobile first paint
    // could clear the legacy map before the server pins arrive.
    if (threads.length > 0) void migrateLegacyPinnedGroups();
  },
  { deep: true },
);

async function migrateLegacyPinnedGroups() {
  if (migratingLegacyPinnedGroups) return;
  const legacyKeys = new Set(
    Object.entries(inactivePinnedKeys.value)
      .filter(([, inactive]) => inactive === true)
      .map(([key]) => key),
  );
  if (legacyKeys.size === 0 || pinnedThreads.value.length === 0) return;

  migratingLegacyPinnedGroups = true;
  try {
    for (const thread of pinnedThreads.value) {
      if (!legacyKeys.has(pinnedThreadKey(thread)) || thread.inactive === true) continue;
      if (!(await config.setPinnedThreadInactive(thread, true))) return;
    }
  } catch {
    // Keep the legacy map as a local fallback if this account cannot be updated right now.
    return;
  } finally {
    migratingLegacyPinnedGroups = false;
  }
  localStorage.removeItem(PINNED_GROUPS_KEY);
  inactivePinnedKeys.value = {};
}

defineOptions({
  inheritAttrs: false,
});

function openAddProject(host: HostRecord) {
  projectEditor.value = { host, project: null };
}

function openEditProject(project: ProjectRecord) {
  const host = hosts.value.find((item) => item.id === project.hostId);
  if (!host) {
    return;
  }
  projectEditor.value = { host, project };
}

async function openHostMonitor(hostId: number) {
  if (selectedHostId.value !== hostId) await catalog.selectHost(hostId);
  await nextTick();
  workspaceActions.openHostMonitor();
}

function startNewThread(hostId: number) {
  const project = selectNewThreadProject({
    hostId,
    selectedHostId: selectedHostId.value,
    selectedProjectId: selectedProjectId.value,
    projects: catalog.projects,
    activity: Object.values(summariesByKey.value),
  });
  void threadView.startThread({}, { hostId, projectId: project?.id ?? null });
}
</script>

<template>
  <aside
    v-bind="$attrs"
    class="relative flex h-full min-h-0 flex-col border-r border-hairline bg-canvas-soft"
  >
    <div
      v-if="!workspaceToolbar"
      class="flex min-h-14 shrink-0 items-center border-b border-hairline bg-canvas-soft/95 px-4 pr-14 backdrop-blur"
    >
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-ink">Codex Gateway</p>
        <p class="truncate text-xs text-ink-muted">{{ selectedHostTitle }}</p>
      </div>
    </div>
    <SidebarWorkspaceToolbar
      v-if="workspaceToolbar"
      :title="selectedHostTitle"
      :can-launch="canLaunch"
      :tmux-active-count="tmuxActiveCount"
      :hosts="hosts"
      @open-tmux="tmuxLauncher.open"
      @open-terminal="workspaceActions.openTerminal"
      @open-browser="showBrowserDialog = true"
      @open-host-monitor="workspaceActions.openHostMonitor"
      @new-thread="startNewThread"
    />
    <div class="flex min-h-0 flex-1 overflow-hidden px-3 py-3">
      <SidebarScrollArea>
        <div class="min-w-0 max-w-full space-y-4 overflow-hidden pr-1">
          <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
            <button
              class="flex h-8 w-full items-center justify-between gap-2 rounded px-2 pb-2 text-left text-sm text-ink-muted hover:bg-surface"
              :aria-expanded="activePinnedExpanded"
              @click="
                activePinnedExpanded = !activePinnedExpanded;
                persistSidebarSections();
              "
            >
              <span
                >Active
                <span class="text-xs text-ink-faint">({{ activePinnedThreads.length }})</span></span
              >
              <ChevronDownIcon
                class="size-4 transition-transform"
                :class="{ '-rotate-90': !activePinnedExpanded }"
              />
            </button>
            <PinnedThreadList
              v-if="activePinnedExpanded"
              :threads="activePinnedThreads"
              :hosts="hosts"
              :selected-host-id="selectedHostId"
              :selected-thread-id="selectedThreadId"
              :long-press-handlers="longPressContextMenuHandlers"
              :runtime-status="pinnedRuntimeStatus"
              :completion-attention="pinnedCompletionAttention"
              :resource-usage-for-host="usageForHost"
              move-label="Move to Inactive"
              :move-host-label="hosts.length > 1 ? t('app.moveThreadToHost') : undefined"
              :show-header="false"
              @open="openPinnedThread"
              @unpin="navigation.setPinnedThread($event, false)"
              @move="movePinnedThread($event, true)"
              @move-host="requestThreadMove"
              @rename="threadRename.startRename"
            />
          </section>

          <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
            <button
              class="flex h-8 w-full items-center justify-between gap-2 rounded px-2 pb-2 text-left text-sm text-ink-muted hover:bg-surface"
              :aria-expanded="inactivePinnedExpanded"
              @click="
                inactivePinnedExpanded = !inactivePinnedExpanded;
                persistSidebarSections();
              "
            >
              <span
                >Inactive
                <span class="text-xs text-ink-faint"
                  >({{ inactivePinnedThreads.length }})</span
                ></span
              >
              <ChevronDownIcon
                class="size-4 transition-transform"
                :class="{ '-rotate-90': !inactivePinnedExpanded }"
              />
            </button>
            <PinnedThreadList
              v-if="inactivePinnedExpanded"
              :threads="inactivePinnedThreads"
              :hosts="hosts"
              :selected-host-id="selectedHostId"
              :selected-thread-id="selectedThreadId"
              :long-press-handlers="longPressContextMenuHandlers"
              :runtime-status="pinnedRuntimeStatus"
              :completion-attention="pinnedCompletionAttention"
              :resource-usage-for-host="usageForHost"
              move-label="Move to Active"
              :move-host-label="hosts.length > 1 ? t('app.moveThreadToHost') : undefined"
              :show-header="false"
              @open="openPinnedThread"
              @unpin="navigation.setPinnedThread($event, false)"
              @move="movePinnedThread($event, false)"
              @move-host="requestThreadMove"
              @rename="threadRename.startRename"
            />
          </section>

          <RecentThreadList
            :threads="recentThreads"
            :selected-host-id="selectedHostId"
            :selected-thread-id="selectedThreadId"
            :long-press-handlers="longPressContextMenuHandlers"
            :resource-usage-for-host="usageForHost"
            :expanded="recentChatsExpanded"
            :move-host-label="hosts.length > 1 ? t('app.moveThreadToHost') : undefined"
            @open="recentActivity.openRecentThread"
            @pin="recentActivity.pinRecentThread"
            @rename="threadRename.startRename"
            @move-host="requestThreadMove"
            @toggle="
              recentChatsExpanded = !recentChatsExpanded;
              persistSidebarSections();
            "
          />

          <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
            <button
              class="flex h-8 w-full items-center justify-between gap-2 rounded px-2 pb-2 text-left text-sm text-ink-muted hover:bg-surface"
              :aria-expanded="hostsExpanded"
              @click="
                hostsExpanded = !hostsExpanded;
                persistSidebarSections();
              "
            >
              <span>{{ $t("app.hosts") }}</span>
              <ChevronDownIcon
                class="size-4 transition-transform"
                :class="{ '-rotate-90': !hostsExpanded }"
              />
            </button>
            <HostTree v-if="hostsExpanded" :controller="hostTreeController" :show-header="false" />
          </section>
        </div>
      </SidebarScrollArea>
    </div>

    <SidebarFooter class="shrink-0 border-t border-hairline p-3">
      <Button
        data-testid="settings-toggle"
        variant="ghost"
        class="h-10 w-full justify-start gap-3 rounded-lg px-3 text-[0.9375rem] font-normal hover:bg-surface"
        @click="showSettings = !showSettings"
      >
        <SettingsIcon class="size-4" />
        {{ t("app.settings") }}
      </Button>
    </SidebarFooter>

    <BrowserOpenDialog
      v-if="workspaceToolbar"
      v-model:open="showBrowserDialog"
      :open-target="workspaceActions.openBrowser"
    />

    <Dialog v-model:open="showSettings">
      <DialogContent
        class="flex h-[min(54rem,calc(100vh-3rem))] w-[min(70rem,calc(100vw-3rem))] !max-w-[min(70rem,calc(100vw-3rem))] flex-col overflow-hidden p-0"
        data-testid="settings-dialog"
        close-button-test-id="settings-close-button"
      >
        <DialogHeader class="border-b border-hairline px-6 py-5">
          <DialogTitle class="text-lg">{{ t("app.settings") }}</DialogTitle>
          <DialogDescription>{{ t("app.settingsDescription") }}</DialogDescription>
        </DialogHeader>
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <SettingsPanel @close="showSettings = false" />
        </div>
      </DialogContent>
    </Dialog>

    <AddProjectDialog
      :open="Boolean(projectEditor)"
      :host="projectEditor?.host ?? null"
      :project="projectEditor?.project ?? null"
      @update:open="projectEditor = $event ? projectEditor : null"
    />

    <!-- Rename is a single modal workflow for desktop context-click and mobile long-press. Keep
         it outside row renderers: context menus unmount after selection, and an inline input inside
         that subtree loses focus or disappears when a mobile sidebar Sheet updates. -->
    <ThreadRenameDialog
      v-model:open="threadRename.open.value"
      v-model="threadRename.renameValue.value"
      :submitting="threadRename.submitting.value"
      @submit="threadRename.submitRename"
    />

    <ThreadMoveDialog
      :open="threadMove !== null"
      :source-host-id="threadMove?.hostId ?? 0"
      :source-thread-id="threadMove?.threadId ?? ''"
      :source-title="threadMove?.title ?? ''"
      :source-cwd="threadMove?.sourceCwd ?? null"
      :hosts="hosts"
      :projects="catalog.projects"
      :submitting="threadMoveSubmitting"
      :error="threadMoveError"
      @update:open="closeThreadMove"
      @submit="submitThreadMove"
    />
  </aside>
</template>
