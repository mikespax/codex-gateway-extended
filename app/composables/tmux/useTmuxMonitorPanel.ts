import { computed, ref, watch } from "vue";
import { toast } from "@codex-gateway/ui/sonner";
import type { TmuxMonitor, TmuxMonitorMode, TmuxPaneSnapshot } from "~~/shared/types";
import { useTmuxMonitorDashboard } from "./useTmuxMonitorDashboard";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import type { TmuxRemoteHostState } from "@/stores/gateway-tmux";
import { paneSnapshotFromMonitor } from "@/stores/gateway-tmux/pane";
import { gatewayErrorMessage } from "@/utils/gateway-error";
import { trimmedOrFallback } from "~~/shared/utils/strings";
import { useTmuxSessionSubscriptions } from "./useTmuxSessionSubscriptions";

const EMPTY_REMOTE_STATE: TmuxRemoteHostState = {
  sessions: [],
  scanning: false,
  error: "",
};

export function useTmuxMonitorPanel() {
  const tmux = useGatewayTmuxStore();
  const dashboard = useTmuxMonitorDashboard();
  const { t } = useI18n();
  const addingPaneKey = ref<string | null>(null);
  const promotingMonitorId = ref<number | null>(null);
  const expandedHostIds = ref(new Set<number>());
  const panelRoot = ref<HTMLElement | null>(null);
  const preview = ref<{ hostId: number; pane: TmuxPaneSnapshot } | null>(null);
  const previewHostTitle = computed(() =>
    preview.value
      ? trimmedOrFallback(
          dashboard.hostNames.value[preview.value.hostId],
          `Host ${preview.value.hostId}`,
        )
      : "",
  );

  function monitorsForHost(hostId: number) {
    return tmux.active.filter((monitor) => monitor.hostId === hostId);
  }

  function remoteStateForHost(hostId: number) {
    return tmux.remoteHosts[hostId] ?? EMPTY_REMOTE_STATE;
  }

  function activeCountForHost(hostId: number) {
    return tmux.active.filter((monitor) => monitor.hostId === hostId).length;
  }

  function setHostExpanded(hostId: number, expanded: boolean) {
    const next = new Set(expandedHostIds.value);
    if (expanded) next.add(hostId);
    else next.delete(hostId);
    expandedHostIds.value = next;
  }

  // Dockview keeps inactive renderers mounted. The subscription composable owns visibility,
  // reconnect and disposal as one lifecycle so no hidden panel can retain a server-side scanner.
  useTmuxSessionSubscriptions(panelRoot, expandedHostIds);

  watch(
    [() => tmux.panelOpen, dashboard.currentHostId],
    ([open, hostId]) => {
      // Opening the dashboard from a conversation should reveal that Host immediately.
      // Other Hosts remain lazy: expanding their tree node starts the singleflight SSH scan.
      if (open && hostId !== null) setHostExpanded(hostId, true);
    },
    { immediate: true },
  );

  async function addMonitor(hostId: number, pane: TmuxPaneSnapshot, mode: TmuxMonitorMode) {
    const binding = dashboard.currentThreadBindingForHost(hostId);
    const paneKey = `${hostId}:${pane.sessionId}:${pane.paneId}`;
    if (addingPaneKey.value !== null) return;
    addingPaneKey.value = paneKey;
    try {
      await tmux.addMonitor(hostId, pane, binding, mode);
      toast.success(
        t(mode === "permanent" ? "app.tmuxPermanentMonitorAdded" : "app.tmuxMonitorAdded", {
          session: pane.sessionName,
          host: trimmedOrFallback(dashboard.hostNames.value[hostId], `Host ${hostId}`),
          thread: trimmedOrFallback(binding?.threadTitle, t("app.tmuxHostLevelMonitor")),
        }),
      );
    } catch (error) {
      toast.error(gatewayErrorMessage(error, t("app.tmuxAddFailed")));
    } finally {
      addingPaneKey.value = null;
    }
  }

  async function promoteMonitor(monitor: TmuxMonitor) {
    if (promotingMonitorId.value !== null) return;
    promotingMonitorId.value = monitor.id;
    try {
      await tmux.promoteMonitor(monitor.hostId, monitor.id);
      toast.success(t("app.tmuxMonitorPromoted", { session: monitor.sessionName }));
    } catch (error) {
      toast.error(gatewayErrorMessage(error, t("app.tmuxPromoteFailed")));
    } finally {
      promotingMonitorId.value = null;
    }
  }

  async function cancelMonitor(monitor: TmuxMonitor) {
    try {
      await tmux.cancelMonitor(monitor.hostId, monitor.id);
    } catch (error) {
      toast.error(gatewayErrorMessage(error, t("app.tmuxCancelFailed")));
    }
  }

  async function monitorAgain(monitor: TmuxMonitor) {
    await tmux.refreshSessions(monitor.hostId);
    const state = tmux.remoteStateFor(monitor.hostId);
    const pane = state.sessions
      .find((candidate) => candidate.name === monitor.sessionName)
      ?.panes.find(
        (candidate) =>
          candidate.windowIndex === monitor.windowIndex &&
          candidate.paneIndex === monitor.paneIndex &&
          (monitor.mode === "permanent" || candidate.running),
      );
    if (pane === undefined) {
      toast.error(trimmedOrFallback(state.error, t("app.tmuxPreviousPaneUnavailable")));
      return;
    }
    const binding =
      monitor.threadId !== null && monitor.threadId !== ""
        ? {
            projectId: monitor.projectId,
            threadId: monitor.threadId,
            threadTitle: trimmedOrFallback(monitor.threadTitle, monitor.threadId),
          }
        : null;
    try {
      await tmux.addMonitor(monitor.hostId, pane, binding, monitor.mode);
      toast.success(
        t(monitor.mode === "permanent" ? "app.tmuxPermanentMonitorAdded" : "app.tmuxMonitorAdded", {
          session: pane.sessionName,
          host: trimmedOrFallback(
            dashboard.hostNames.value[monitor.hostId],
            `Host ${monitor.hostId}`,
          ),
          thread: trimmedOrFallback(binding?.threadTitle, t("app.tmuxHostLevelMonitor")),
        }),
      );
    } catch (error) {
      toast.error(gatewayErrorMessage(error, t("app.tmuxAddFailed")));
    }
  }

  function previewPane(hostId: number, pane: TmuxPaneSnapshot) {
    preview.value = { hostId, pane };
  }

  function previewMonitor(monitor: TmuxMonitor) {
    previewPane(monitor.hostId, paneSnapshotFromMonitor(monitor));
  }

  return {
    tmux,
    dashboard,
    addingPaneKey,
    promotingMonitorId,
    expandedHostIds,
    panelRoot,
    preview,
    previewHostTitle,
    monitorsForHost,
    remoteStateForHost,
    activeCountForHost,
    setHostExpanded,
    addMonitor,
    promoteMonitor,
    cancelMonitor,
    monitorAgain,
    previewPane,
    previewMonitor,
  };
}
