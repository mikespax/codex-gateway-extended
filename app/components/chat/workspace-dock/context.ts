import type { IDockviewPanel } from "dockview-vue";

import { inject, type ComputedRef, type InjectionKey, type Ref } from "vue";

export interface WorkspaceFilesPanelContext {
  layout: Ref<"desktop" | "mobile">;
  selectedThreadId: Ref<string | null>;
  selectedProjectId: Ref<number | null>;
  selectedHostId: Ref<number | null>;
  rootPath: ComputedRef<string>;
}

export interface WorkspaceDockUiContext {
  layout: Ref<"desktop" | "mobile">;
  closePanel: (panel: IDockviewPanel) => void;
}

export const WORKSPACE_FILES_PANEL_CONTEXT: InjectionKey<WorkspaceFilesPanelContext> = Symbol(
  "workspace-files-panel-context",
);
export const WORKSPACE_DOCK_UI_CONTEXT: InjectionKey<WorkspaceDockUiContext> = Symbol(
  "workspace-dock-ui-context",
);

export function requireWorkspaceFilesPanelContext() {
  return requireContext(WORKSPACE_FILES_PANEL_CONTEXT, "Workspace files panel context");
}

export function requireWorkspaceDockUiContext() {
  return requireContext(WORKSPACE_DOCK_UI_CONTEXT, "Workspace dock UI context");
}

function requireContext<T>(key: InjectionKey<T>, name: string) {
  const context = inject(key);
  if (context === undefined) throw new Error(`${name} is unavailable`);
  return context;
}
