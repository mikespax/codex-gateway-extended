import { defineStore, skipHydrate } from "pinia";
import type {
  BrowserPreviewResourceFailure,
  BrowserPreviewSessionSnapshot,
  BrowserPreviewTarget,
} from "~~/shared/types";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";

export interface BrowserPanelState extends BrowserPreviewTarget {
  title: string;
}

export const useGatewayBrowserStore = defineStore("gateway-browser", () => {
  const panels = useAccountLocalStorage<Record<string, BrowserPanelState>>("browser-panels", {});
  const sessions = ref<Record<string, BrowserPreviewSessionSnapshot>>({});
  const frameWarnings = ref<Record<string, string>>({});
  const resourceFailures = ref<Record<string, BrowserPreviewResourceFailure[]>>({});

  function addPanel(panel: BrowserPanelState) {
    panels.value = { ...panels.value, [panel.panelId]: panel };
  }

  function removePanel(panelId: string) {
    const panel = panels.value[panelId];
    const sessionId = Object.values(sessions.value).find(
      (session) => session.panelId === panelId,
    )?.sessionId;
    const { [panelId]: _panel, ...remainingPanels } = panels.value;
    panels.value = remainingPanels;
    if (sessionId !== undefined) removeSession(sessionId);
    return { panel, sessionId };
  }

  function upsertSession(session: BrowserPreviewSessionSnapshot) {
    const previous = Object.values(sessions.value).find(
      (candidate) => candidate.panelId === session.panelId,
    );
    const next = { ...sessions.value };
    if (previous !== undefined) delete next[previous.sessionId];
    next[session.sessionId] = session;
    sessions.value = next;
  }

  function removeSession(sessionId: string) {
    const { [sessionId]: _session, ...remaining } = sessions.value;
    sessions.value = remaining;
    const { [sessionId]: _warning, ...warnings } = frameWarnings.value;
    frameWarnings.value = warnings;
    clearResourceFailures(sessionId);
  }

  function setFrameWarning(sessionId: string, value: string) {
    frameWarnings.value = { ...frameWarnings.value, [sessionId]: value };
  }

  function addResourceFailure(sessionId: string, failure: BrowserPreviewResourceFailure) {
    // Preview HTTP events are user-scoped, so other tabs receive them too. Keep diagnostics only
    // in the page that owns the runtime session rather than accumulating unreachable session IDs.
    if (sessions.value[sessionId] === undefined) return;
    const previous = resourceFailures.value[sessionId] ?? [];
    const duplicateIndex = previous.findIndex(
      (item) =>
        item.statusCode === failure.statusCode &&
        item.method === failure.method &&
        item.path === failure.path,
    );
    const withoutDuplicate = previous.filter((_, index) => index !== duplicateIndex);
    resourceFailures.value = {
      ...resourceFailures.value,
      [sessionId]: [...withoutDuplicate, failure].slice(-5),
    };
  }

  function clearResourceFailures(sessionId: string) {
    const { [sessionId]: _failures, ...remaining } = resourceFailures.value;
    resourceFailures.value = remaining;
  }

  function sessionForPanel(panelId: string) {
    return Object.values(sessions.value).find((session) => session.panelId === panelId) ?? null;
  }

  function resetRuntime() {
    sessions.value = {};
    frameWarnings.value = {};
    resourceFailures.value = {};
  }

  return {
    panels: skipHydrate(panels),
    sessions,
    frameWarnings,
    resourceFailures,
    addPanel,
    removePanel,
    upsertSession,
    removeSession,
    setFrameWarning,
    addResourceFailure,
    clearResourceFailures,
    sessionForPanel,
    resetRuntime,
  };
});
