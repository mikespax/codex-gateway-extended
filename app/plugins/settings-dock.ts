import SettingsDockTab from "@/components/settings/settings-dock/SettingsDockTab.vue";
import { defineAsyncComponent } from "vue";

const asyncPanels = {
  SettingsDockAppearancePanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockAppearancePanel.vue"),
  ),
  SettingsDockConfigPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockConfigPanel.vue"),
  ),
  SettingsDockHostPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockHostPanel.vue"),
  ),
  SettingsDockNotificationPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockNotificationPanel.vue"),
  ),
};

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("SettingsDockTab", SettingsDockTab);
  for (const [name, component] of Object.entries(asyncPanels)) {
    nuxtApp.vueApp.component(name, component);
  }
});
