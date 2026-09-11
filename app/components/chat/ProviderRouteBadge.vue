<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { gatewayApi } from "@/utils/gateway-api";

const { selectedHostId, selectedThreadId } = storeToRefs(useGatewayNavigationStore());
const { t } = useI18n();
const route = ref<{
  model: string | null;
  transport: string | null;
  reason: string | null;
  recordedAt: string | null;
} | null>(null);
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const reason = computed(() => {
  const code = route.value?.reason ?? "";
  if (code.includes("unavailable")) return t("app.routeFallback");
  if (code.includes("quota_exhausted")) return t("app.routeQuota");
  if (code.includes("deepseek_only")) return t("app.providerModeDeepseek");
  if (code.includes("openai_only")) return t("app.providerModeOpenai");
  if (code.includes("off_peak")) return t("app.routeOffPeak");
  if (code.includes("openai_peak")) return t("app.routePeak");
  return t("app.routeStored");
});
async function refresh() {
  if (document.hidden) return;
  const hostId = selectedHostId.value;
  const threadId = selectedThreadId.value;
  const request = ++generation;
  if (hostId === null || threadId === null) {
    route.value = null;
    return;
  }
  try {
    const result = await gatewayApi<NonNullable<typeof route.value>>(
      "/api/provider-router/thread",
      { query: { hostId, threadId } },
    );
    if (request === generation) route.value = result;
  } catch {
    if (request === generation) route.value = null;
  }
}
watch([selectedHostId, selectedThreadId], () => {
  generation++;
  route.value = null;
  void refresh();
});
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 10_000);
});
onBeforeUnmount(() => {
  generation++;
  clearInterval(timer);
});
</script>

<template>
  <div
    v-if="route?.model"
    data-testid="provider-route-badge"
    role="status"
    class="min-w-0 max-w-48 truncate rounded-md bg-canvas-soft px-2 py-1 text-[0.6875rem] text-ink-muted"
    :title="`${route.model} · ${route.transport ?? ''} · ${reason}`"
  >
    <div class="truncate font-medium text-ink">{{ route.model }}</div>
    <div class="truncate">
      {{ reason }}<span v-if="route.transport === 'openrouter'"> · OpenRouter</span>
    </div>
  </div>
</template>
