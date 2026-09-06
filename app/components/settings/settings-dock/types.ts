export type SettingsPanelKind =
  | "appearance"
  | "config"
  | "hosts"
  | "notifications"
  | "providerRouting";

export interface SettingsDockPanelParams {
  kind: SettingsPanelKind;
}
