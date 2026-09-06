import { storeToRefs } from "pinia";

import { computed } from "vue";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayTerminalStore } from "@/stores/gateway-terminal";
import { useGatewayBrowserStore } from "@/stores/gateway-browser";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { subAgentDisplayName } from "@/components/thread/subagent/display-name";
import {
  subAgentWorkspacePanelId,
  terminalWorkspacePanelId,
  browserWorkspacePanelId,
  TMUX_WORKSPACE_PANEL_ID,
} from "@/stores/gateway/workspace-panels";
import type { WorkspacePanelSelection } from "./types";
import { useGatewayHostMetricsPanelStore } from "@/stores/gateway-host-metrics/panels";
import { workspaceLayoutScopeKey } from "@/stores/gateway-workspace-layout";
import { useFileGitReviewPanelStore } from "@/stores/file-workspace/git/review-panel";
import { GIT_REVIEW_WORKSPACE_PANEL_ID } from "@/stores/gateway/workspace-panels";
import { HOST_METRICS_WORKSPACE_PANEL_ID } from "@/stores/gateway/workspace-panels";

export function useWorkspacePanels(selection: WorkspacePanelSelection) {
  const { t } = useI18n();
  const catalog = useGatewayCatalogStore();
  const threadView = useGatewayThreadViewStore();
  const terminalStore = useGatewayTerminalStore();
  const browserStore = useGatewayBrowserStore();
  const tmuxStore = useGatewayTmuxStore();
  const hostMetricsPanels = useGatewayHostMetricsPanelStore();
  const gitReviewPanels = useFileGitReviewPanelStore();
  const { terminalSessions } = storeToRefs(terminalStore);
  const { threadViews, currentThread, visibleSubAgentPanels } = storeToRefs(threadView);

  const terminalPanels = computed(() =>
    Object.values(terminalSessions.value)
      .filter((session) => {
        if (session.hostId !== selection.selectedHostId.value) return false;
        if (session.scope === "thread")
          return session.threadId === selection.selectedThreadId.value;
        if (session.scope === "project") {
          return (
            selection.selectedThreadId.value === null &&
            session.projectId === selection.selectedProjectId.value
          );
        }
        return (
          selection.selectedThreadId.value === null && selection.selectedProjectId.value === null
        );
      })
      .map((session) => ({ id: terminalWorkspacePanelId(session.sessionId), session })),
  );

  const subAgentPanels = computed(() =>
    visibleSubAgentPanels.value.map((panel) => {
      const key = pinnedKey(panel.hostId, panel.threadId);
      const thread = threadViews.value[key]?.currentThread ?? null;
      return {
        id: subAgentWorkspacePanelId(key),
        hostId: panel.hostId,
        threadId: panel.threadId,
        title: subAgentDisplayName({
          thread,
          titleCandidate: panel.title,
          threadId: panel.threadId,
          fallback: t("app.subAgentPanel"),
        }),
      };
    }),
  );

  const browserPanels = computed(() =>
    Object.values(browserStore.panels)
      .filter(
        (panel) =>
          panel.hostId === selection.selectedHostId.value &&
          (panel.projectId ?? null) === (selection.selectedProjectId.value ?? null) &&
          (panel.threadId ?? null) === (selection.selectedThreadId.value ?? null),
      )
      .map((panel) => ({ id: browserWorkspacePanelId(panel.panelId), panel })),
  );

  const tmuxPanels = computed(() => {
    if (!tmuxStore.panelOpen) return [];
    return [{ id: TMUX_WORKSPACE_PANEL_ID }];
  });
  const hostMetricsPanel = computed(() => {
    const hostId = selection.selectedHostId.value;
    if (hostId === null) return [];
    const scopeKey = workspaceLayoutScopeKey(
      hostId,
      selection.selectedProjectId.value,
      selection.selectedThreadId.value,
    );
    return hostMetricsPanels.isOpen(scopeKey)
      ? [{ id: HOST_METRICS_WORKSPACE_PANEL_ID, hostId }]
      : [];
  });
  const gitReviewPanel = computed(() => {
    const scopeKey = workspaceLayoutScopeKey(
      selection.selectedHostId.value,
      selection.selectedProjectId.value,
      selection.selectedThreadId.value,
    );
    return gitReviewPanels.isOpen(scopeKey) ? [{ id: GIT_REVIEW_WORKSPACE_PANEL_ID }] : [];
  });

  const fileWorkspaceRoot = computed(() => {
    const cwd = currentThread.value?.cwd ?? "";
    if (cwd !== "") return cwd;
    return projectById(catalog.projects, selection.selectedProjectId.value)?.remotePath ?? "";
  });

  return {
    terminalPanels,
    subAgentPanels,
    browserPanels,
    tmuxPanels,
    hostMetricsPanel,
    gitReviewPanel,
    fileWorkspaceRoot,
  };
}
