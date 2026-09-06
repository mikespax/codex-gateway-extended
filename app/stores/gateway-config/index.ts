import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { klona } from "klona";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";
import type {
  GatewayConfig,
  GatewayNotificationSettings,
  PinnedThreadRecord,
} from "~~/shared/types";
import { useAuthStore } from "@/stores/auth";
import { gatewayApi } from "@/utils/gateway-api";
import { defaultGatewayConfig, normalizeNotificationSettings } from "@/stores/gateway/config";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import { createPinnedThreadSync } from "./pinned-thread-sync";
import { recordFromUnknown } from "~~/shared/utils/records";
import { captureSessionEpoch } from "@/utils/session-epoch";

export const useGatewayConfigStore = defineStore("gateway-config", () => {
  const t = useGatewayTranslator();
  const gatewayConfig = ref<GatewayConfig>(defaultGatewayConfig());
  const pinnedThreadSync = createPinnedThreadSync({ apply: applyPinnedThreads });

  function applyPinnedThreads(pinnedThreads: GatewayConfig["pinnedThreads"]) {
    gatewayConfig.value = { ...gatewayConfig.value, pinnedThreads };
    gatewayDomainEvents.emit("gateway-config-applied", { config: gatewayConfig.value });
  }

  function setCatalog(hosts: GatewayConfig["hosts"], projects: GatewayConfig["projects"]) {
    gatewayConfig.value = {
      version: 1,
      hosts: [...hosts],
      projects: [...projects],
      pinnedThreads: gatewayConfig.value.pinnedThreads,
      notifications: normalizeNotificationSettings(gatewayConfig.value.notifications),
    };
  }

  function applyConfig(config: GatewayConfig) {
    gatewayConfig.value = { ...defaultGatewayConfig(), ...config };
    gatewayDomainEvents.emit("gateway-config-applied", { config: gatewayConfig.value });
  }

  async function loadConfigFromServer() {
    const auth = useAuthStore();
    const epoch = auth.sessionEpoch;
    const config = await gatewayApi<GatewayConfig>("/api/config/export");
    if (!auth.isCurrentSession(epoch)) return false;
    applyConfig(config);
    return true;
  }

  function exportConfigText() {
    return JSON.stringify(gatewayConfig.value, null, 2);
  }

  async function importConfigText(text: string) {
    const auth = useAuthStore();
    const epoch = auth.sessionEpoch;
    const result = await gatewayApi<GatewayConfig>("/api/config/sync", {
      method: "POST",
      body: { ...defaultGatewayConfig(), ...recordFromUnknown(JSON.parse(text)) },
    });
    if (!auth.isCurrentSession(epoch)) return false;
    applyConfig(result);
    return true;
  }

  async function saveNotificationSettings(notifications: GatewayNotificationSettings) {
    const sessionIsCurrent = captureSessionEpoch();
    gatewayConfig.value.notifications = normalizeNotificationSettings(notifications);
    const result = await gatewayApi<GatewayConfig>("/api/config/notifications", {
      method: "POST",
      body: { notifications: gatewayConfig.value.notifications },
    });
    if (!sessionIsCurrent()) return false;
    applyConfig(result);
    if (import.meta.client) toast.success(t("app.notificationSettingsSaved"));
    return true;
  }

  async function setPinnedThread(thread: PinnedThreadRecord, pinned: boolean) {
    const sessionIsCurrent = captureSessionEpoch();
    const result = await gatewayApi<GatewayConfig>("/api/config/pinned-threads", {
      method: "POST",
      body: pinned
        ? { pinned: true, thread: klona(thread) }
        : { pinned: false, hostId: thread.hostId, threadId: thread.threadId },
    });
    if (!sessionIsCurrent()) return false;
    applyConfig(result);
    return true;
  }

  async function setPinnedThreadInactive(thread: PinnedThreadRecord, inactive: boolean) {
    return setPinnedThread({ ...thread, inactive }, true);
  }

  function resetState() {
    gatewayConfig.value = defaultGatewayConfig();
    pinnedThreadSync.reset();
  }

  return {
    gatewayConfig,
    setCatalog,
    applyConfig,
    loadConfigFromServer,
    exportConfigText,
    importConfigText,
    saveNotificationSettings,
    setPinnedThread,
    setPinnedThreadInactive,
    refreshPinnedThreads: pinnedThreadSync.refresh,
    resetState,
  };
});

export function useGatewayPinnedThreads() {
  const config = useGatewayConfigStore();
  return computed(() => config.gatewayConfig.pinnedThreads);
}
