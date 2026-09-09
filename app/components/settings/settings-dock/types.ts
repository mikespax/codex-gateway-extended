export type SettingsPanelKind = "appearance" | "config" | "hosts" | "models" | "notifications";

export interface SettingsDockPanelParams {
  kind: SettingsPanelKind;
}
