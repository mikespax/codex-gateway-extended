import type { HostRecord, ProjectRecord } from "./records";
import type { ProviderRoutingSettings } from "./provider-routing";

export interface PinnedThreadRecord {
  hostId: number;
  projectId: number | null;
  threadId: string;
  title: string;
  subtitle?: string | null;
  projectName?: string | null;
  updatedAt?: number | null;
  /** True when the user keeps this pinned thread out of the active sidebar group. */
  inactive?: boolean;
}

export interface BarkNotificationSettings {
  enabled: boolean;
  serverUrl: string;
  deviceKey: string;
  group?: string | null;
}

export interface GatewayNotificationSettings {
  bark: BarkNotificationSettings;
}

export interface GatewayConfig {
  version: 1;
  hosts: HostRecord[];
  projects: ProjectRecord[];
  pinnedThreads: PinnedThreadRecord[];
  notifications: GatewayNotificationSettings;
  /** Optional for backwards compatibility with encrypted configs written before routing existed. */
  providerRouting?: ProviderRoutingSettings;
}
