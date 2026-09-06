import { defineNuxtPlugin } from "nuxt/app";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import type { ServerNotification, ThreadGoalStatus } from "~~/shared/types";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";

export type GoalControlCapture = { type: "status"; status: ThreadGoalStatus } | { type: "clear" };

export interface GatewayE2eCaptures {
  goalObjective: string | null;
  goalControls: GoalControlCapture[];
}

export interface GatewayE2eTestDriver {
  captures: GatewayE2eCaptures;
  bootstrap: ReturnType<typeof useGatewayBootstrapStore>;
  catalog: ReturnType<typeof useGatewayCatalogStore>;
  composer: ReturnType<typeof useGatewayComposerStore>;
  config: ReturnType<typeof useGatewayConfigStore>;
  navigation: ReturnType<typeof useGatewayNavigationStore>;
  realtime: ReturnType<typeof useGatewayRealtimeStore>;
  runtime: ReturnType<typeof useGatewayThreadRuntimeStore>;
  activity: ReturnType<typeof useGatewayThreadActivityStore>;
  turns: ReturnType<typeof useGatewayThreadTurnsStore>;
  views: ReturnType<typeof useGatewayThreadViewStore>;
  publishNotification: (notification: ServerNotification) => void;
}

function createGatewayE2eTestDriver(): GatewayE2eTestDriver {
  return {
    captures: {
      goalObjective: null,
      goalControls: [],
    },
    bootstrap: useGatewayBootstrapStore(),
    catalog: useGatewayCatalogStore(),
    composer: useGatewayComposerStore(),
    config: useGatewayConfigStore(),
    navigation: useGatewayNavigationStore(),
    realtime: useGatewayRealtimeStore(),
    runtime: useGatewayThreadRuntimeStore(),
    activity: useGatewayThreadActivityStore(),
    turns: useGatewayThreadTurnsStore(),
    views: useGatewayThreadViewStore(),
    publishNotification(notification) {
      gatewayDomainEvents.emit("realtime-notification-published", {
        notification,
        actionLabel: "Open thread",
      });
    },
  };
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    // Several setup stores consume Vue injections such as i18n. Creating them while Nuxt is still
    // installing plugins runs outside a component setup scope and Vue I18n rejects that lifecycle.
    // The root workspace has initialized these public stores by app:mounted, so the test driver can
    // bind typed store APIs without reaching into Pinia's private registry.
    window.__codexGatewayE2e = createGatewayE2eTestDriver();
  });
});

declare global {
  interface Window {
    __codexGatewayE2e?: GatewayE2eTestDriver;
  }
}
