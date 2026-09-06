import type { HostRecord } from "~~/shared/types";
import { hostRuntimeFingerprint } from "./host-runtime-fingerprint";

export interface HostRuntimeSlot {
  userId: number;
  hostId: number;
  host: HostRecord;
  fingerprint: string;
  generation: number;
  retryCount: number;
  timer: ReturnType<typeof setTimeout> | null;
  connecting: boolean;
  connectPromise: Promise<void> | null;
}

export function createHostRuntimeSlot(userId: number, host: HostRecord): HostRuntimeSlot {
  return {
    userId,
    hostId: host.id,
    host,
    fingerprint: hostRuntimeFingerprint(host),
    generation: 0,
    retryCount: 0,
    timer: null,
    connecting: false,
    connectPromise: null,
  };
}

export function updateHostRuntimeSlot(slot: HostRuntimeSlot, host: HostRecord) {
  const nextFingerprint = hostRuntimeFingerprint(host);
  if (slot.fingerprint !== nextFingerprint) {
    return { changedHost: true };
  }

  slot.host = host;
  return { changedHost: false };
}
