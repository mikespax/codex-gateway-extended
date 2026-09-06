import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";
import type { GatewayErrorState } from "@/stores/gateway/types";
import { errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

export const useGatewayBootstrapStore = defineStore("gateway-bootstrap", () => {
  const t = useGatewayTranslator();
  const initializing = ref(true);
  const error = ref<GatewayErrorState | null>(null);
  const errorLabels = computed(() => errorMessageLabels(t));

  function clearError() {
    error.value = null;
  }

  function setError(
    message: string,
    context: {
      hostId?: number | null;
      projectId?: number | null;
      threadId?: string | null;
      turnId?: string | null;
      transient?: boolean;
    } = {},
  ) {
    error.value = {
      message,
      hostId: context.hostId ?? null,
      projectId: context.projectId ?? null,
      threadId: context.threadId ?? null,
      turnId: "turnId" in context ? (context.turnId ?? null) : null,
      transient: context.transient === true,
      updatedAt: Date.now(),
    };
    if (import.meta.client) toast.error(message);
  }

  function resetState() {
    initializing.value = true;
    error.value = null;
  }

  return {
    initializing,
    error,
    errorLabels,
    t,
    clearError,
    setError,
    resetState,
  };
});
