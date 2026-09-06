import type { HostRecord, PinnedThreadRecord, ProjectRecord } from "~~/shared/types";

export type { HostRecord, PinnedThreadRecord, ProjectRecord };

/** App-server thread list fields vary by Codex release. Keep the UI boundary explicit without
 * leaking `any` through the Host/Project tree. */
export interface SidebarThread extends Record<string, unknown> {
  id: string | number;
  updatedAt?: number | null;
  pinned?: boolean;
  threadBytes?: number | null;
}

export type SidebarThreadRow = SidebarThread | PinnedThreadRecord;
