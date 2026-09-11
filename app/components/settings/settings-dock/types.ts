export type SettingsPanelKind =
  | "appearance"
  | "config"
  | "hosts"
  | "models"
  | "notifications"
  | "providerRouting";

export interface SettingsDockPanelParams {
  kind: SettingsPanelKind;
}
