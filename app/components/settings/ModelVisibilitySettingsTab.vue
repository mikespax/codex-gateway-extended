<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import type { ModelRecord } from "~~/shared/types";
import { RefreshCwIcon, RotateCcwIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { Checkbox } from "@codex-gateway/ui/checkbox";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";

const catalog = useGatewayCatalogStore();
const navigation = useGatewayNavigationStore();
const { openAiModels, loadingModels, modelsHostId } = storeToRefs(catalog);
const { selectedHostId } = storeToRefs(navigation);
const { t } = useI18n();

const sortedModels = computed(() =>
  [...openAiModels.value].sort((left, right) => {
    const leftLabel = (left.displayName || left.model || left.id).toLocaleLowerCase();
    const rightLabel = (right.displayName || right.model || right.id).toLocaleLowerCase();
    return leftLabel.localeCompare(rightLabel);
  }),
);

const selectedHostModelsLoaded = computed(
  () => selectedHostId.value !== null && modelsHostId.value === selectedHostId.value,
);

async function loadSelectedHostModels() {
  if (selectedHostId.value === null || modelsHostId.value === selectedHostId.value) return;
  await catalog.listModels();
}

function refreshModels() {
  if (selectedHostId.value === null) return;
  void catalog.listModels();
}

function modelLabel(model: { displayName: string; model: string; id: string }) {
  return model.displayName || model.model || model.id;
}

function modelKey(model: { id: string; model: string }) {
  return model.id.trim() || model.model.trim();
}

function updateModelVisibility(model: ModelRecord, value: boolean | "indeterminate") {
  catalog.setModelVisibility(model, value === true);
}

onMounted(() => {
  void loadSelectedHostModels();
});

watch(selectedHostId, () => {
  void loadSelectedHostModels();
});
</script>

<template>
  <div class="max-w-2xl space-y-5">
    <div class="space-y-1">
      <h2 class="text-base font-medium text-ink">{{ t("app.modelVisibilitySettings") }}</h2>
      <p class="text-sm leading-6 text-ink-secondary">
        {{ t("app.modelVisibilitySettingsDescription") }}
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-ink-muted">
        <template v-if="selectedHostModelsLoaded">
          {{ t("app.modelVisibilityCount", { count: sortedModels.length }) }}
        </template>
        <template v-else-if="selectedHostId === null">
          {{ t("app.modelVisibilitySelectHost") }}
        </template>
        <template v-else>
          {{ t("app.loadingModels") }}
        </template>
      </p>
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          :disabled="loadingModels || selectedHostId === null"
          @click="catalog.resetModelVisibility"
        >
          <RotateCcwIcon class="size-4" />
          {{ t("app.resetModelVisibility") }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          :disabled="loadingModels || selectedHostId === null"
          @click="refreshModels"
        >
          <RefreshCwIcon class="size-4" />
          {{ t("app.refreshModels") }}
        </Button>
      </div>
    </div>

    <div
      v-if="loadingModels"
      class="rounded-xl border border-hairline bg-canvas-soft/60 p-4 text-sm text-ink-secondary"
    >
      {{ t("app.loadingModels") }}
    </div>
    <div
      v-else-if="selectedHostId === null"
      class="rounded-xl border border-hairline bg-canvas-soft/60 p-4 text-sm text-ink-secondary"
    >
      {{ t("app.modelVisibilitySelectHost") }}
    </div>
    <div
      v-else-if="!selectedHostModelsLoaded || sortedModels.length === 0"
      class="rounded-xl border border-hairline bg-canvas-soft/60 p-4 text-sm text-ink-secondary"
    >
      {{ t("app.noOpenAiModels") }}
    </div>
    <div v-else class="divide-y divide-hairline rounded-xl border border-hairline">
      <label
        v-for="(model, index) in sortedModels"
        :key="modelKey(model)"
        class="flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-canvas-soft/60"
        :for="`openai-model-${index}`"
        :data-testid="`openai-model-visibility-${modelKey(model)}`"
      >
        <Checkbox
          :id="`openai-model-${index}`"
          :model-value="catalog.isModelVisible(model)"
          class="mt-0.5"
          @update:model-value="updateModelVisibility(model, $event)"
        />
        <span class="min-w-0">
          <span class="block text-sm font-medium text-ink">{{ modelLabel(model) }}</span>
          <span class="mt-1 block truncate text-xs text-ink-muted">{{
            model.model || model.id
          }}</span>
        </span>
      </label>
    </div>
  </div>
</template>
