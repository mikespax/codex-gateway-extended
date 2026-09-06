<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { ModelRecord, ReasoningEffort } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@codex-gateway/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";

const DEFAULT_EFFORT = "default";

const props = defineProps<{
  models: ModelRecord[];
  loadingModels: boolean;
  activeModel: string;
  activeModelLabel: string;
  activeEffortValue: string;
  activeEffortCompactLabel: string;
  activeServiceTier: string;
  activeServiceTierLabel: string;
  effortOptions: Array<{ value: ReasoningEffort; label?: string }>;
  serviceTierOptions: Array<{ value: string; label: string; description?: string | null }>;
  labelEffortOption: (option: { value: ReasoningEffort; label?: string }) => string;
  modelOptionValue: (modelOption: { model?: string; id: string }) => string;
}>();

const emit = defineEmits<{
  apply: [selection: { model: string; effort: ReasoningEffort; serviceTier: string }];
}>();

const { t } = useI18n();
const selectorOpen = ref(false);
const draftModel = ref("");
const draftEffort = ref<ReasoningEffort>(DEFAULT_EFFORT);
const draftServiceTier = ref("default");

const draftModelRecord = computed(() =>
  props.models.find(
    (candidate) =>
      candidate.model === draftModel.value ||
      candidate.id === draftModel.value ||
      props.modelOptionValue(candidate) === draftModel.value,
  ),
);
const draftEffortOptions = computed(() => {
  const options = (draftModelRecord.value?.supportedReasoningEfforts ?? []).map((option) => ({
    value: option.reasoningEffort,
    label: option.reasoningEffort,
  }));
  if (
    draftEffort.value !== DEFAULT_EFFORT &&
    !options.some((option) => option.value === draftEffort.value)
  ) {
    options.unshift({ value: draftEffort.value, label: draftEffort.value });
  }
  return options;
});
const draftServiceTierOptions = computed(() => {
  const advertisedTiers =
    draftModelRecord.value === undefined
      ? props.serviceTierOptions
      : (draftModelRecord.value.serviceTiers ?? []);
  const options = advertisedTiers.map((option) =>
    "value" in option
      ? option
      : {
          value: option.id,
          label: option.name || option.id,
          description: option.description ?? null,
        },
  );
  if (
    draftServiceTier.value !== "default" &&
    !options.some((option) => option.value === draftServiceTier.value)
  ) {
    options.unshift({
      value: draftServiceTier.value,
      label: draftServiceTier.value,
      description: null,
    });
  }
  return options;
});

watch(selectorOpen, (open) => {
  if (!open) return;
  draftModel.value =
    props.activeModel || (props.models[0] ? props.modelOptionValue(props.models[0]) : "");
  draftEffort.value = props.activeEffortValue || DEFAULT_EFFORT;
  draftServiceTier.value = props.activeServiceTier || "default";
});

function updateDraftModel(model: unknown) {
  if (typeof model !== "string") return;
  draftModel.value = model;
  const selectedModel = props.models.find(
    (candidate) => props.modelOptionValue(candidate) === model,
  );
  const supported = selectedModel?.supportedReasoningEfforts ?? [];
  if (
    draftEffort.value !== DEFAULT_EFFORT &&
    !supported.some((option) => option.reasoningEffort === draftEffort.value)
  ) {
    draftEffort.value = DEFAULT_EFFORT;
  }
  if (
    draftServiceTier.value !== "default" &&
    !(selectedModel?.serviceTiers ?? []).some((option) => option.id === draftServiceTier.value)
  ) {
    draftServiceTier.value = "default";
  }
}

function cancelSelection() {
  selectorOpen.value = false;
}

function applySelection() {
  if (draftModel.value === "") return;
  emit("apply", {
    model: draftModel.value,
    effort: draftEffort.value,
    serviceTier: draftServiceTier.value,
  });
  selectorOpen.value = false;
}

function preventInitialFocus(event: Event) {
  event.preventDefault();
}
</script>

<template>
  <Dialog v-model:open="selectorOpen">
    <DialogTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        class="min-w-0 max-w-full gap-1.5 px-1.5 text-sm font-normal text-ink-secondary hover:bg-canvas-soft sm:gap-2 sm:px-2 md:text-base"
        data-testid="model-select"
        :disabled="loadingModels || !models.length"
      >
        <span class="flex min-w-0 items-center gap-1.5 sm:hidden">
          <span class="truncate text-ink">{{
            loadingModels ? t("app.loadingModels") : activeModelLabel
          }}</span>
          <span v-if="activeEffortCompactLabel" class="shrink-0 text-ink-muted">
            {{ activeEffortCompactLabel }}
          </span>
          <span v-if="activeServiceTierLabel" class="shrink-0 text-ink-muted">
            {{ activeServiceTierLabel }}
          </span>
        </span>
        <span class="hidden truncate text-ink sm:inline">{{
          loadingModels ? t("app.loadingModels") : activeModelLabel
        }}</span>
        <span v-if="activeEffortCompactLabel" class="hidden shrink-0 text-ink-muted sm:inline">
          {{ activeEffortCompactLabel }}
        </span>
        <span v-if="activeServiceTierLabel" class="hidden shrink-0 text-ink-muted sm:inline">
          {{ activeServiceTierLabel }}
        </span>
        <ChevronDownIcon class="size-4 text-ink-muted" />
      </Button>
    </DialogTrigger>

    <DialogContent
      class="max-h-[min(82dvh,32rem)] w-[min(92vw,28rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border-hairline p-0 shadow-xl shadow-ink/10"
      close-button-test-id="model-selector-close"
      data-testid="model-selector-dialog"
      @open-auto-focus="preventInitialFocus"
    >
      <DialogTitle class="border-b border-hairline px-5 py-4 pr-12 text-base font-medium text-ink">
        {{ t("app.modelAndReasoning") }}
      </DialogTitle>

      <div class="grid min-h-0 gap-5 overflow-y-auto px-5 py-5">
        <label class="grid gap-2 text-xs font-medium text-ink-secondary">
          <span>{{ t("app.reasoningEffort") }}</span>
          <Select v-model="draftEffort">
            <SelectTrigger
              class="h-12 w-full rounded-xl px-3 text-sm"
              data-testid="reasoning-effort-select"
            >
              <SelectValue :placeholder="t('app.reasoningDefault')" />
            </SelectTrigger>
            <SelectContent position="popper" class="max-h-[min(45dvh,20rem)]">
              <SelectItem :value="DEFAULT_EFFORT" class="min-h-11 text-sm">
                {{ t("app.reasoningDefault") }}
              </SelectItem>
              <SelectItem
                v-for="option in draftEffortOptions"
                :key="option.value"
                :value="option.value"
                :data-testid="`effort-option-${option.value}`"
                class="min-h-11 text-sm"
              >
                {{ labelEffortOption(option) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label
          v-if="draftServiceTierOptions.length"
          class="grid gap-2 text-xs font-medium text-ink-secondary"
        >
          <span>{{ t("app.serviceTier") }}</span>
          <Select v-model="draftServiceTier">
            <SelectTrigger
              class="h-12 w-full rounded-xl px-3 text-sm"
              data-testid="service-tier-select"
            >
              <SelectValue :placeholder="t('app.serviceTierDefault')" />
            </SelectTrigger>
            <SelectContent position="popper" class="max-h-[min(45dvh,20rem)]">
              <SelectItem value="default" class="min-h-11 text-sm">
                {{ t("app.serviceTierDefault") }}
              </SelectItem>
              <SelectItem
                v-for="option in draftServiceTierOptions"
                :key="option.value"
                :value="option.value"
                :data-testid="`service-tier-option-${option.value}`"
                class="min-h-11 text-sm"
              >
                <span class="flex flex-col">
                  <span>{{ option.label }}</span>
                  <span v-if="option.description" class="text-[0.625rem] text-muted-foreground">
                    {{ option.description }}
                  </span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label class="grid gap-2 text-xs font-medium text-ink-secondary">
          <span>{{ t("app.model") }}</span>
          <Select :model-value="draftModel" @update:model-value="updateDraftModel">
            <SelectTrigger
              class="h-12 w-full rounded-xl px-3 text-sm"
              data-testid="model-dropdown-select"
            >
              <SelectValue :placeholder="t('app.model')" />
            </SelectTrigger>
            <SelectContent position="popper" class="max-h-[min(45dvh,20rem)]">
              <SelectItem
                v-for="modelOption in models"
                :key="modelOption.id"
                :value="modelOptionValue(modelOption)"
                :data-testid="`model-option-${modelOptionValue(modelOption)}`"
                class="min-h-11 text-sm"
              >
                {{ modelOption.displayName || modelOption.model || modelOption.id }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div
        class="flex items-center justify-end gap-2 border-t border-hairline bg-popover px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <Button
          type="button"
          variant="ghost"
          class="min-h-11 min-w-24"
          data-testid="model-selector-cancel"
          @click="cancelSelection"
        >
          {{ t("app.cancel") }}
        </Button>
        <Button
          type="button"
          class="min-h-11 min-w-24"
          data-testid="model-selector-ok"
          :disabled="draftModel === ''"
          @click="applySelection"
        >
          {{ t("app.ok") }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
