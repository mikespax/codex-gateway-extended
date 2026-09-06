import type { GatewayConfig } from "~~/shared/types";
import { useAuthStore } from "@/stores/auth";
import { gatewayApi } from "@/utils/gateway-api";

export function createPinnedThreadSync(options: {
  apply: (pinnedThreads: GatewayConfig["pinnedThreads"]) => void;
}) {
  let pending: Promise<void> | null = null;
  let refreshAgain = false;
  let resetEpoch = 0;

  function refresh() {
    if (pending) {
      // Preserve an invalidation that races the current fetch instead of silently dropping it.
      refreshAgain = true;
      return pending;
    }
    const request = refreshUntilCurrent().finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return request;
  }

  async function refreshUntilCurrent() {
    const auth = useAuthStore();
    const sessionEpoch = auth.sessionEpoch;
    const currentResetEpoch = resetEpoch;
    do {
      refreshAgain = false;
      const config = await gatewayApi<GatewayConfig>("/api/config/export");
      if (!auth.isCurrentSession(sessionEpoch) || currentResetEpoch !== resetEpoch) return;
      options.apply(config.pinnedThreads);
    } while (refreshAgain);
  }

  function reset() {
    resetEpoch += 1;
    refreshAgain = false;
    pending = null;
  }

  return { refresh, reset };
}
