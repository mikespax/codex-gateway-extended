<script setup lang="ts">
import type { GetTabContextMenuItemsParams } from "dockview-vue";
import { DockviewVue, themeDark, themeLight } from "dockview-vue";
import { computed, provide, ref, toRefs } from "vue";
import { useTerminalTheme } from "@/composables/terminal/useTerminalTheme";
import { useChatWorkspaceState } from "../chat-workspace-state";
import { fileWorkspaceScopeKey } from "@/stores/file-workspace";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { workspaceLayoutScopeKey } from "@/stores/gateway-workspace-layout";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";
import MobileWorkspaceHeader from "../MobileWorkspaceHeader.vue";
import { createDockTabMenu } from "./actions";
import { WORKSPACE_DOCK_UI_CONTEXT, WORKSPACE_FILES_PANEL_CONTEXT } from "./context";
import type { WorkspaceDockProps } from "./types";
import { useWorkspaceDockLifecycle } from "./useWorkspaceDockLifecycle";
import { useWorkspaceDockPanels } from "./useWorkspaceDockPanels";
import { useWorkspacePanels } from "./useWorkspacePanels";
import "dockview-vue/dist/styles/dockview.css";

const props = defineProps<WorkspaceDockProps>();
const refs = toRefs(props);
const workspace = useChatWorkspaceState();
const fileWorkspace = useGatewayFileWorkspaceStore();
const { t } = useI18n();
const { isDark } = useTerminalTheme();
const scopeKey = computed(() =>
  workspaceLayoutScopeKey(
    workspace.selectedHostId.value,
    workspace.selectedProjectId.value,
    workspace.selectedThreadId.value,
  ),
);
const {
  terminalPanels,
  subAgentPanels,
  browserPanels,
  tmuxPanels,
  hostMetricsPanel,
  gitReviewPanel,
  fileWorkspaceRoot,
} = useWorkspacePanels({
  selectedHostId: workspace.selectedHostId,
  selectedProjectId: workspace.selectedProjectId,
  selectedThreadId: workspace.selectedThreadId,
});
const fileRequestScopeKey = computed(() =>
  workspace.selectedHostId.value && workspace.selectedThreadId.value
    ? fileWorkspaceScopeKey(workspace.selectedHostId.value, workspace.selectedThreadId.value)
    : null,
);
const filesPanelOpen = computed(
  () => fileWorkspace.workspaceOpenRequest?.scopeKey === fileRequestScopeKey.value,
);
const agentPanelTitle = computed(() =>
  workspace.currentThread.value ? titleForThread(workspace.currentThread.value) : t("app.agentTab"),
);
const panels = useWorkspaceDockPanels({
  agentPanelTitle,
  terminalPanels,
  subAgentPanels,
  browserPanels,
  tmuxPanels,
  hostMetricsPanel,
  gitReviewPanel,
  filesPanelOpen,
  scopeKey,
});
const panelIds = computed(() => [
  agentPanelTitle.value,
  filesPanelOpen.value,
  terminalPanels.value.map(({ id }) => id),
  subAgentPanels.value.map(({ id }) => id),
  browserPanels.value.map(({ id }) => id),
  tmuxPanels.value.map(({ id }) => id),
  hostMetricsPanel.value.map(({ id }) => id),
  gitReviewPanel.value.map(({ id }) => id),
]);
const dockviewHost = ref<HTMLElement | null>(null);
const lifecycle = useWorkspaceDockLifecycle({
  scopeKey,
  host: dockviewHost,
  fileRequestScopeKey,
  filesPanelOpen,
  reconcile: panels.reconcile,
  defaultLayout: panels.defaultLayout,
  panelIds,
});
const dockTheme = computed(() => (isDark.value ? themeDark : themeLight));

provide(WORKSPACE_FILES_PANEL_CONTEXT, {
  layout: refs.layout,
  selectedThreadId: workspace.selectedThreadId,
  selectedProjectId: workspace.selectedProjectId,
  selectedHostId: workspace.selectedHostId,
  rootPath: fileWorkspaceRoot,
});
provide(WORKSPACE_DOCK_UI_CONTEXT, {
  layout: refs.layout,
  closePanel: panels.closeDynamic,
});

function tabContextMenu({ panel, api }: GetTabContextMenuItemsParams) {
  return createDockTabMenu({
    api,
    panel,
    closeDynamic: panels.closeDynamic,
    labels: {
      splitRight: t("app.splitRight"),
      maximize: t("app.maximizePanel"),
      float: t("app.floatPanel"),
      popout: t("app.popoutPanel"),
      close: t("app.closeTab"),
      popupBlocked: t("app.popupBlocked"),
      popupBlockedDescription: t("app.popupBlockedDescription"),
    },
  });
}
</script>

<template>
  <div
    data-testid="workspace-dock-frame"
    class="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
  >
    <MobileWorkspaceHeader v-if="layout === 'mobile'" :host-id="workspace.selectedHostId.value">
      <template #start><slot name="mobile-header-start" /></template>
    </MobileWorkspaceHeader>
    <!--
      h-0 + flex-1 gives the Dockview host a definite remaining height. Keeping an auto height here
      lets a restored grid contribute its stale intrinsic height during a keyed thread switch,
      which can shorten the whole workspace even though every panel agrees with its host.
    -->
    <div ref="dockviewHost" class="gateway-dockview h-0 min-h-0 w-full flex-1 overflow-hidden">
      <DockviewVue
        class="h-full w-full"
        :right-header-actions-component="
          layout === 'desktop' ? 'WorkspaceDockGroupActions' : undefined
        "
        :theme="dockTheme"
        floating-group-bounds="boundedWithinViewport"
        :disable-floating-groups="layout === 'mobile'"
        :locked="layout === 'mobile'"
        :keyboard-navigation="true"
        :get-tab-context-menu-items="layout === 'desktop' ? tabContextMenu : undefined"
        @ready="lifecycle.ready"
      />
    </div>
  </div>
</template>

<style scoped>
.gateway-dockview {
  --dv-background-color: var(--canvas);
  --dv-paneview-active-outline-color: var(--primary);
  --dv-tabs-and-actions-container-background-color: var(--canvas-soft);
  --dv-activegroup-visiblepanel-tab-background-color: var(--surface);
  --dv-activegroup-hiddenpanel-tab-background-color: var(--canvas-soft);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--surface);
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--canvas-soft);
  --dv-tab-divider-color: var(--hairline);
  --dv-separator-border: var(--hairline);
  --dv-active-sash-color: var(--primary);
}
</style>
