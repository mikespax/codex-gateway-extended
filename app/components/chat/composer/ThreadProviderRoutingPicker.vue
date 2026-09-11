<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { gatewayApi } from "@/utils/gateway-api";
import type { ProviderRoutingSettings } from "~~/shared/types";

type Selection =
  | "inherit"
  | "openai"
  | "deepseek-direct"
  | "hybrid-direct"
  | "deepseek-openrouter"
  | "hybrid-openrouter";

type ThreadRoutingResponse = {
  override: ProviderRoutingSettings | null;
};

const navigation = useGatewayNavigationStore();
const { selectedHostId, selectedThreadId } = storeToRefs(navigation);
const { t } = useI18n();
const selection = ref<Selection>("inherit");
const savedSelection = ref<Selection>("inherit");
const saving = ref(false);
const error = ref("");
let generation = 0;

const options = computed<Array<{ value: Selection; label: string }>>(() => [
  { value: "inherit", label: t("app.threadProviderInherit") },
  { value: "openai", label: t("app.threadProviderOpenai") },
  { value: "deepseek-direct", label: t("app.threadProviderDeepseekDirect") },
  { value: "hybrid-direct", label: t("app.threadProviderHybridDirect") },
  { value: "deepseek-openrouter", label: t("app.threadProviderDeepseekOpenrouter") },
  { value: "hybrid-openrouter", label: t("app.threadProviderHybridOpenrouter") },
]);

watch([selectedHostId, selectedThreadId], () => void refresh(), { immediate: true });

async function refresh() {
  const hostId = selectedHostId.value;
  const threadId = selectedThreadId.value;
  const request = ++generation;
  error.value = "";
  if (hostId === null || threadId === null) {
    selection.value = "inherit";
    savedSelection.value = "inherit";
    return;
  }
  try {
    const result = await gatewayApi<ThreadRoutingResponse>("/api/provider-router/thread", {
      query: { hostId, threadId },
    });
    if (request !== generation) return;
    const next = selectionFromOverride(result.override);
    selection.value = next;
    savedSelection.value = next;
  } catch (caught: unknown) {
    if (request !== generation) return;
    error.value = caught instanceof Error ? caught.message : String(caught);
    selection.value = "inherit";
    savedSelection.value = "inherit";
  }
}

async function save() {
  const hostId = selectedHostId.value;
  const threadId = selectedThreadId.value;
  if (hostId === null || threadId === null || saving.value) return;
  const requested = selection.value;
  saving.value = true;
  error.value = "";
  try {
    await gatewayApi("/api/provider-router/thread", {
      method: "PATCH",
      query: { hostId, threadId },
      body: settingsForSelection(requested),
    });
    savedSelection.value = requested;
  } catch (caught: unknown) {
    selection.value = savedSelection.value;
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

function selectionFromOverride(override: ProviderRoutingSettings | null): Selection {
  if (override === null) return "inherit";
  if (override.mode === "openai") return "openai";
  if (override.mode === "hybrid") {
    return override.useOpenRouterCreditsFirst ? "hybrid-openrouter" : "hybrid-direct";
  }
  return override.useOpenRouterCreditsFirst ? "deepseek-openrouter" : "deepseek-direct";
}

function settingsForSelection(
  value: Selection,
): { mode: ProviderRoutingSettings["mode"]; useOpenRouterCreditsFirst: boolean } | { mode: null } {
  switch (value) {
    case "openai":
      return { mode: "openai", useOpenRouterCreditsFirst: false };
    case "deepseek-direct":
      return { mode: "deepseek", useOpenRouterCreditsFirst: false };
    case "hybrid-direct":
      return { mode: "hybrid", useOpenRouterCreditsFirst: false };
    case "deepseek-openrouter":
      return { mode: "deepseek", useOpenRouterCreditsFirst: true };
    case "hybrid-openrouter":
      return { mode: "hybrid", useOpenRouterCreditsFirst: true };
    case "inherit":
      return { mode: null };
  }
}
</script>

<template>
  <label
    class="flex min-w-0 max-w-40 items-center"
    :title="error || $t('app.threadProviderRouting')"
  >
    <span class="sr-only">{{ $t("app.threadProviderRouting") }}</span>
    <select
      v-model="selection"
      data-testid="thread-provider-routing"
      class="h-8 min-w-0 max-w-40 rounded-md border border-transparent bg-canvas-soft px-1.5 text-[0.6875rem] text-ink-muted outline-none transition hover:border-border hover:text-ink focus:border-primary focus:text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:max-w-48 sm:px-2"
      :disabled="selectedHostId === null || selectedThreadId === null || saving"
      :aria-label="$t('app.threadProviderRouting')"
      @change="void save()"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <span v-if="saving" class="sr-only">{{ $t("app.threadProviderSaving") }}</span>
  </label>
</template>
