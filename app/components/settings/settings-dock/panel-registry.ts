import type { SettingsPanelKind } from "./types";

interface SettingsPanelPolicy {
  component: string;
  titleKey: string;
}

export const settingsPanelRegistry = {
  appearance: {
    component: "SettingsDockAppearancePanel",
    titleKey: "app.appearanceSettings",
  },
  config: {
    component: "SettingsDockConfigPanel",
    titleKey: "app.configJson",
  },
  hosts: {
    component: "SettingsDockHostPanel",
    titleKey: "app.hosts",
  },
  models: {
    component: "SettingsDockModelPanel",
    titleKey: "app.modelVisibilitySettings",
  },
  notifications: {
    component: "SettingsDockNotificationPanel",
    titleKey: "app.notificationSettings",
  },
  providerRouting: {
    component: "SettingsDockProviderRoutingPanel",
    titleKey: "app.providerRouting",
  },
} satisfies Record<SettingsPanelKind, SettingsPanelPolicy>;

export const settingsPanelKinds = [
  "appearance",
  "config",
  "hosts",
  "models",
  "notifications",
  "providerRouting",
] as const satisfies readonly SettingsPanelKind[];
