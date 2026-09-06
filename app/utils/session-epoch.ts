import { useAuthStore } from "@/stores/auth";

/** Captures ownership for async work that may outlive the authenticated browser session. */
export function captureSessionEpoch() {
  const auth = useAuthStore();
  const epoch = auth.sessionEpoch;
  return () => auth.isCurrentSession(epoch);
}
