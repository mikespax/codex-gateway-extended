import type { SerializedDockview } from "dockview-vue";
import { defineStore, skipHydrate } from "pinia";
import { ref } from "vue";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";
import { AGENT_WORKSPACE_PANEL_ID } from "../gateway/workspace-panels";

export const useGatewayWorkspaceLayoutStore = defineStore("gateway-workspace-layout", () => {
  const layoutsByScope = useAccountLocalStorage<Record<string, SerializedDockview>>(
    "workspace-layouts",
    {},
  );
  const activePanelByScope = useAccountLocalStorage<Record<string, string>>(
    "workspace-active-panels",
    {},
  );
  const panelActivationRequest = ref<{ panelId: string; sequence: number } | null>(null);

  const layoutFor = (scopeKey: string) => layoutsByScope.value[scopeKey] ?? null;
  const activePanelFor = (scopeKey: string) =>
    activePanelByScope.value[scopeKey] ?? AGENT_WORKSPACE_PANEL_ID;

  function saveLayout(scopeKey: string, layout: SerializedDockview) {
    layoutsByScope.value = { ...layoutsByScope.value, [scopeKey]: layout };
  }

  function setActivePanel(scopeKey: string, panelId: string) {
    activePanelByScope.value = { ...activePanelByScope.value, [scopeKey]: panelId };
  }

  function requestPanelActivation(panelId: string) {
    panelActivationRequest.value = {
      panelId,
      sequence: (panelActivationRequest.value?.sequence ?? 0) + 1,
    };
  }

  function consumePanelActivation(sequence: number) {
    if (panelActivationRequest.value?.sequence === sequence) {
      panelActivationRequest.value = null;
    }
  }

  function resetRuntimeState() {
    panelActivationRequest.value = null;
  }

  return {
    layoutsByScope: skipHydrate(layoutsByScope),
    activePanelByScope: skipHydrate(activePanelByScope),
    panelActivationRequest,
    layoutFor,
    activePanelFor,
    saveLayout,
    setActivePanel,
    requestPanelActivation,
    consumePanelActivation,
    resetRuntimeState,
  };
});

export function workspaceLayoutScopeKey(
  hostId: number | null,
  projectId: number | null,
  threadId: string | null,
) {
  return `${hostId ?? "host"}:${projectId ?? "project"}:${threadId ?? "thread"}`;
}
