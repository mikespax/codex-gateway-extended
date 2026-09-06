<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RefreshCwIcon, RotateCcwIcon, SaveIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { Switch } from "@codex-gateway/ui/switch";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { normalizeProviderRouting } from "@/stores/gateway/config";
import { gatewayApi } from "@/utils/gateway-api";
import type { ProviderRoutingSettings, ProviderRoutingStatus } from "~~/shared/types";

const store = useGatewayConfigStore();
const { t } = useI18n();
const form = ref<ProviderRoutingSettings>(
  normalizeProviderRouting(store.gatewayConfig.providerRouting),
);
const status = ref<ProviderRoutingStatus | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const modes = computed(
  () =>
    [
      { value: "openai", label: t("app.providerModeOpenai") },
      { value: "hybrid", label: t("app.providerModeHybrid") },
      { value: "deepseek", label: t("app.providerModeDeepseek") },
    ] as const,
);

watch(
  () => store.gatewayConfig.providerRouting,
  (value) => {
    form.value = normalizeProviderRouting(value);
  },
  { immediate: true, deep: true },
);

onMounted(() => {
  void refreshStatus();
  refreshTimer = setInterval(() => void refreshStatus(), 6 * 60 * 60 * 1_000);
});

onUnmounted(() => {
  if (refreshTimer !== null) clearInterval(refreshTimer);
});

async function refreshStatus() {
  loading.value = true;
  error.value = "";
  try {
    status.value = await gatewayApi<ProviderRoutingStatus>("/api/provider-router/status");
    if (status.value !== null) {
      form.value = {
        mode: status.value.mode,
        useOpenRouterCreditsFirst: status.value.useOpenRouterCreditsFirst,
      };
    }
  } catch (caught: unknown) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  try {
    await store.saveProviderRouting(form.value);
    await refreshStatus();
  } catch (caught: unknown) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function recheckOpenAi() {
  try {
    status.value = await gatewayApi<ProviderRoutingStatus>("/api/provider-router/recheck-openai", {
      method: "POST",
    });
  } catch (caught: unknown) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function recheckOpenRouter() {
  try {
    status.value = await gatewayApi<ProviderRoutingStatus>(
      "/api/provider-router/recheck-openrouter",
      {
        method: "POST",
      },
    );
  } catch (caught: unknown) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return t("app.providerUnknown");
  return new Date(value).toLocaleString();
}
</script>

<template>
  <div class="max-w-2xl space-y-5">
    <div class="space-y-1">
      <div class="font-medium">{{ t("app.providerRouting") }}</div>
      <p class="text-sm text-ink-secondary">{{ t("app.providerRoutingDescription") }}</p>
    </div>

    <div class="rounded-xl border border-hairline bg-canvas-soft/70 p-4">
      <div class="space-y-3">
        <div class="text-sm font-medium">{{ t("app.providerMode") }}</div>
        <label
          v-for="mode in modes"
          :key="mode.value"
          class="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline p-3 transition hover:border-primary/60"
          :class="form.mode === mode.value ? 'border-primary bg-primary/10' : ''"
        >
          <input
            v-model="form.mode"
            type="radio"
            name="provider-mode"
            :value="mode.value"
            class="mt-1 accent-primary"
          />
          <span class="text-sm">{{ mode.label }}</span>
        </label>
      </div>
      <div class="mt-4 flex items-start justify-between gap-4 border-t border-hairline pt-4">
        <div>
          <div class="text-sm font-medium">{{ t("app.useOpenRouterCreditsFirst") }}</div>
          <p class="text-sm text-ink-secondary">
            {{ t("app.useOpenRouterCreditsFirstDescription") }}
          </p>
        </div>
        <Switch v-model="form.useOpenRouterCreditsFirst" />
      </div>
      <div class="mt-4 flex justify-end">
        <Button :disabled="saving" @click="save">
          <SaveIcon class="size-4" />
          {{ saving ? t("app.saving") : t("app.saveProviderRouting") }}
        </Button>
      </div>
    </div>

    <div class="rounded-xl border border-hairline bg-canvas-soft/70 p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="text-sm font-medium">{{ t("app.providerCurrentRoute") }}</div>
        <Button variant="outline" size="sm" :disabled="loading" @click="refreshStatus">
          <RefreshCwIcon class="size-4" />
          {{ t("app.refresh") }}
        </Button>
      </div>
      <div v-if="status" class="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <span class="text-ink-muted">{{ t("app.providerEffective") }}:</span>
          {{ status.effectiveProvider }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerTransport") }}:</span>
          {{ status.transport }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerModel") }}:</span>
          {{ status.model ?? t("app.providerNotApplicable") }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerPricing") }}:</span>
          {{ status.deepseekPeriod }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerNextChange") }}:</span>
          {{ formatDate(status.nextPricingTransitionAt) }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerOpenAiQuota") }}:</span>
          {{ status.openaiQuota }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerOpenRouter") }}:</span>
          {{ status.openrouter }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerDirectDeepseek") }}:</span>
          {{ status.directDeepseek }}
        </div>
        <div>
          <span class="text-ink-muted">{{ t("app.providerReason") }}:</span> {{ status.reason }}
        </div>
      </div>
      <div v-else class="text-sm text-ink-secondary">
        {{ loading ? t("app.loadingGateway") : t("app.providerNoStatus") }}
      </div>
      <div class="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-3">
        <Button variant="outline" size="sm" @click="recheckOpenAi">
          <RotateCcwIcon class="size-4" />
          {{ t("app.recheckOpenAi") }}
        </Button>
        <Button variant="outline" size="sm" @click="recheckOpenRouter">
          <RotateCcwIcon class="size-4" />
          {{ t("app.recheckOpenRouter") }}
        </Button>
      </div>
    </div>
    <div
      v-if="error"
      class="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive"
    >
      {{ error }}
    </div>
  </div>
</template>
