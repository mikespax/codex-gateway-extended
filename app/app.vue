<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { Toaster } from "@codex-gateway/ui/sonner";
import LoginScreen from "@/components/auth/LoginScreen.vue";
import { useAuthStore } from "@/stores/auth";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { refreshGatewayClient } from "@/stores/gateway-bootstrap/refresh";
import { resetGatewayClientSession } from "@/stores/gateway-bootstrap/session-reset";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";

const bootstrap = useGatewayBootstrapStore();
const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
const realtime = useGatewayRealtimeStore();
const auth = useAuthStore();
const device = useDevice();
const { initializing } = storeToRefs(bootstrap);
const { selectedThreadId } = storeToRefs(navigation);
const { currentThread } = storeToRefs(threadView);
const { initialized, isAuthenticated, token } = storeToRefs(auth);
const mounted = ref(false);
const compactViewport = ref(false);
let activeSessionToken = "";
let compactViewportQuery: MediaQueryList | null = null;
const layoutName = computed(() =>
  device.isMobileOrTablet || compactViewport.value ? "mobile" : "default",
);
const pageTitle = computed(() => {
  if (!selectedThreadId.value || !currentThread.value) {
    return "Codex Gateway";
  }
  return `${titleForThread(currentThread.value)} - Codex Gateway`;
});

useHead({
  title: pageTitle,
  link: [
    { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
    { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
    { rel: "manifest", href: "/site.webmanifest" },
    { rel: "shortcut icon", href: "/favicon.ico" },
  ],
  meta: [
    {
      name: "viewport",
      content:
        "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
    },
    { name: "theme-color", content: "#ffffff" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: "Codex Gateway" },
  ],
});

onMounted(() => {
  // A desktop browser can be narrowed below the point where a persistent sidebar and useful
  // chat workspace fit together. Treat that compact desktop viewport like mobile: expose the
  // existing Sheet-backed chat drawer instead of leaving the off-canvas desktop sidebar hidden.
  compactViewportQuery = window.matchMedia("(max-width: 959px)");
  compactViewport.value = compactViewportQuery.matches;
  compactViewportQuery.addEventListener("change", updateCompactViewport);
  mounted.value = true;
  auth.hydrate();
});

function updateCompactViewport(event: MediaQueryListEvent) {
  compactViewport.value = event.matches;
}

onBeforeUnmount(() => {
  compactViewportQuery?.removeEventListener("change", updateCompactViewport);
});

watch(
  [initialized, token],
  ([authInitialized, currentToken]) => {
    if (!authInitialized || currentToken === activeSessionToken) {
      return;
    }
    activeSessionToken = currentToken;
    // Reset on every token transition, including logged-out -> logged-in. A request rejected by
    // logout can still finish its catch/finally after the first reset; clearing again before the
    // next account hydrates prevents that stale projection from crossing the session boundary.
    resetGatewayClientSession();
    if (!currentToken) {
      return;
    }
    realtime.installHealthCheck();
    void refreshGatewayClient().catch((error) => {
      console.error("[gateway] failed to refresh app", error);
    });
  },
  { immediate: true },
);
</script>

<template>
  <NuxtRouteAnnouncer />
  <span
    v-if="mounted && (!isAuthenticated || !initializing)"
    data-testid="app-ready"
    class="sr-only"
    >ready</span
  >
  <Toaster rich-colors position="top-right" />
  <LoginScreen v-if="mounted && !isAuthenticated" />
  <NuxtLayout v-else :name="layoutName" />
</template>
