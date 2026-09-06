import WorkspaceDockAgentPanel from "@/components/chat/workspace-dock/WorkspaceDockAgentPanel.vue";
import WorkspaceDockGroupActions from "@/components/chat/workspace-dock/WorkspaceDockGroupActions.vue";
import WorkspaceDockTab from "@/components/chat/workspace-dock/WorkspaceDockTab.vue";
import { defineAsyncComponent } from "vue";

const asyncPanels = {
  WorkspaceDockBrowserPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockBrowserPanel.vue"),
  ),
  WorkspaceDockFilesPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockFilesPanel.vue"),
  ),
  WorkspaceDockGitReviewPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockGitReviewPanel.vue"),
  ),
  WorkspaceDockHostMetricsPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockHostMetricsPanel.vue"),
  ),
  WorkspaceDockSubAgentPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockSubAgentPanel.vue"),
  ),
  WorkspaceDockTerminalPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockTerminalPanel.vue"),
  ),
  WorkspaceDockTmuxPanel: defineAsyncComponent(
    () => import("@/components/chat/workspace-dock/WorkspaceDockTmuxPanel.vue"),
  ),
};

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("WorkspaceDockAgentPanel", WorkspaceDockAgentPanel);
  nuxtApp.vueApp.component("WorkspaceDockGroupActions", WorkspaceDockGroupActions);
  nuxtApp.vueApp.component("WorkspaceDockTab", WorkspaceDockTab);
  for (const [name, component] of Object.entries(asyncPanels)) {
    nuxtApp.vueApp.component(name, component);
  }
});
