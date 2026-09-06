import type { GatewayE2eTestDriver } from "./nuxt-layer/plugins/e2e-test-driver.client";

declare global {
  interface Window {
    __codexGatewayE2e?: GatewayE2eTestDriver;
    __codexGatewayNewThreadContext?: { hostId?: number; projectId?: number | null } | null;
    __timelineRowCountSamples?: number[];
    __timelineRowCountObserver?: MutationObserver;
  }
}

export {};
