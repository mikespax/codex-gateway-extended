import { defineStore, skipHydrate } from "pinia";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";

export const useGatewayHostMetricsPanelStore = defineStore("gateway-host-metrics-panels", () => {
  const openScopes = useAccountLocalStorage<Record<string, boolean>>("host-metrics-panels", {});

  function isOpen(scopeKey: string) {
    return openScopes.value[scopeKey] === true;
  }

  function open(scopeKey: string) {
    openScopes.value = { ...openScopes.value, [scopeKey]: true };
  }

  function close(scopeKey: string) {
    const next = { ...openScopes.value };
    delete next[scopeKey];
    openScopes.value = next;
  }

  return { openScopes: skipHydrate(openScopes), isOpen, open, close };
});
