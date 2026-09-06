import type { DockviewApi, DockviewReadyEvent, SerializedDockview } from "dockview-vue";

import type { ComputedRef, Ref } from "vue";
import { nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import {
  AGENT_WORKSPACE_PANEL_ID,
  FILES_WORKSPACE_PANEL_ID,
} from "@/stores/gateway/workspace-panels";
import { notifyPopoutBlocked } from "./actions";
import { useDockLayoutPersistence } from "./useDockLayoutPersistence";
import { nextAnimationFrame } from "@/utils/browser-scheduling";

export function useWorkspaceDockLifecycle(options: {
  scopeKey: ComputedRef<string>;
  host: Readonly<Ref<HTMLElement | null>>;
  fileRequestScopeKey: ComputedRef<string | null>;
  filesPanelOpen: ComputedRef<boolean>;
  reconcile: (api: DockviewApi) => void;
  defaultLayout: (api: DockviewApi) => SerializedDockview;
  panelIds: ComputedRef<unknown>;
}) {
  const { t } = useI18n();
  const workspaceLayout = useGatewayWorkspaceLayoutStore();
  const fileWorkspace = useGatewayFileWorkspaceStore();
  const api = shallowRef<DockviewApi | null>(null);
  // ChatWorkspace keys this composable's owner by scope. Capture the key once so unmount always
  // persists the layout being left, even after navigation refs already point at the next thread.
  const activeScopeKey = options.scopeKey.value;
  let disposables: Array<{ dispose(): void }> = [];
  const persistence = useDockLayoutPersistence({
    api,
    activeScopeKey: () => activeScopeKey,
  });
  function activate(panelId: string) {
    const panel = api.value?.getPanel(panelId);
    if (!panel) return;
    panel.api.setActive();
    panel.api.group.api.setActive();
  }

  async function ready(event: DockviewReadyEvent) {
    api.value = event.api;
    disposables = [
      event.api.onDidLayoutChange(persistence.scheduleLayoutSave),
      event.api.onWillMutateLayout((mutation) => {
        // Popouts are runtime windows. Capture the docked layout before Dockview removes the group.
        if (mutation.kind === "popout") persistence.captureBeforePopout();
      }),
      event.api.onDidMovePanel(({ panel }) => {
        if (
          panel.id === FILES_WORKSPACE_PANEL_ID &&
          panel.api.group.panels.some(({ id }) => id === AGENT_WORKSPACE_PANEL_ID)
        ) {
          activate(AGENT_WORKSPACE_PANEL_ID);
        }
      }),
      event.api.onDidActivePanelChange(({ panel }) => {
        if (!panel) return;
        const request = workspaceLayout.panelActivationRequest;
        if (request) {
          if (panel.id === request.panelId) {
            workspaceLayout.consumePanelActivation(request.sequence);
          } else if (event.api.getPanel(request.panelId)) {
            activate(request.panelId);
            return;
          }
        }
        workspaceLayout.setActivePanel(activeScopeKey, panel.id);
      }),
      event.api.onDidRemovePanel((panel) => {
        if (panel.id === AGENT_WORKSPACE_PANEL_ID || panel.id === FILES_WORKSPACE_PANEL_ID) {
          void restorePermanentPanels();
        } else {
          void restoreRequestedPanel();
        }
      }),
      event.api.onDidOpenPopoutWindowFail(() =>
        notifyPopoutBlocked({
          title: t("app.popupBlocked"),
          description: t("app.popupBlockedDescription"),
        }),
      ),
    ];

    // Dockview's fromJSON() snapshots the API dimensions before rebuilding its grid. The Vue
    // ready callback runs while a newly keyed Host/Project/Thread flex subtree is still committing,
    // so restoring here synchronously records a transient height and can leave the workspace short
    // after returning to a thread. Wait for that subtree's first layout frame, initialize Dockview
    // with the host's final dimensions, and only then deserialize. This fixes the ordering race at
    // its source; do not add post-restore observers, delayed repair loops, or panel-local sizing.
    await nextTick();
    await nextAnimationFrame();
    const host = options.host.value;
    if (api.value !== event.api || !host) return;
    event.api.layout(host.clientWidth, host.clientHeight, true);
    initializeScope(activeScopeKey);
  }

  function initializeScope(scopeKey: string) {
    if (!api.value) return;
    const saved = workspaceLayout.layoutFor(scopeKey);
    if (saved) {
      restoreScope(scopeKey);
      return;
    }

    // During DockviewVue's ready callback the Vue renderer registry is initialized, but content
    // adapters created through fromJSON are not yet attached by the wrapper. The documented
    // addPanel path used by reconcile performs that first mount for a new unsaved scope.
    persistence.setDockedLayout(null);
    options.reconcile(api.value);
    activate(workspaceLayout.activePanelFor(scopeKey));
  }

  function restoreScope(scopeKey: string) {
    if (!api.value) return;
    const saved = workspaceLayout.layoutFor(scopeKey);
    const dockedLayoutState = saved ? dockedLayout(saved) : null;
    persistence.setDockedLayout(dockedLayoutState);
    try {
      // Every scope owns a fresh Dockview API, so deserialization cannot reuse an overlay from a
      // different thread. Store-backed editor/terminal data survives independently of panel DOM.
      api.value.fromJSON(dockedLayoutState ?? options.defaultLayout(api.value));
    } catch (error) {
      console.error("[workspace] failed to restore dock layout", error);
      api.value.fromJSON(options.defaultLayout(api.value));
    }
    options.reconcile(api.value);
    activate(workspaceLayout.activePanelFor(scopeKey));
  }

  async function restoreRequestedPanel() {
    await nextTick();
    const request = workspaceLayout.panelActivationRequest;
    if (request) activate(request.panelId);
    const activePanel = api.value?.activePanel;
    if (api.value && (!activePanel || !api.value.getPanel(activePanel.id))) {
      activate(AGENT_WORKSPACE_PANEL_ID);
    }
  }

  async function restorePermanentPanels() {
    await nextTick();
    if (!api.value) return;
    const hasAgent = Boolean(api.value.getPanel(AGENT_WORKSPACE_PANEL_ID));
    const needsFiles = options.filesPanelOpen.value;
    const hasFiles = Boolean(api.value.getPanel(FILES_WORKSPACE_PANEL_ID));
    if (hasAgent && (!needsFiles || hasFiles)) {
      await restoreRequestedPanel();
      return;
    }
    options.reconcile(api.value);
    await restoreRequestedPanel();
  }

  watch(
    options.panelIds,
    async () => {
      if (!api.value) return;
      options.reconcile(api.value);
      const request = workspaceLayout.panelActivationRequest;
      if (request) activate(request.panelId);
      await nextTick();
      const activePanel = api.value.activePanel;
      if (!activePanel || !api.value.getPanel(activePanel.id)) activate(AGENT_WORKSPACE_PANEL_ID);
    },
    { deep: true },
  );
  watch(
    () => workspaceLayout.panelActivationRequest,
    (request) => {
      if (!request || !api.value) return;
      // Dynamic panels are represented by domain stores, while activation is a layout request.
      // Both updates are synchronous, but their Vue watchers are not ordered. Reconcile here before
      // activation so opening a panel never depends on the panel-list watcher winning that race.
      options.reconcile(api.value);
      activate(request.panelId);
    },
  );
  watch(
    () => fileWorkspace.workspaceOpenRequest,
    (request) => {
      if (request?.scopeKey === options.fileRequestScopeKey.value) {
        if (api.value) options.reconcile(api.value);
        activate(FILES_WORKSPACE_PANEL_ID);
      }
    },
  );

  onBeforeUnmount(() => {
    persistence.persistLayout(activeScopeKey);
    for (const popout of api.value?.getPopouts() ?? []) popout.window.close();
    disposables.forEach((disposable) => disposable.dispose());
    disposables = [];
    api.value = null;
  });

  return { ready };
}

function dockedLayout(layout: SerializedDockview): SerializedDockview {
  if (layout.popoutGroups === undefined || layout.popoutGroups.length === 0) return layout;
  const { popoutGroups: _runtimeWindows, ...docked } = layout;
  return docked;
}
