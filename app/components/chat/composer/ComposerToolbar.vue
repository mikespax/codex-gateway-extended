<script setup lang="ts">
import {
  CheckIcon,
  FileArchiveIcon,
  ImagePlusIcon,
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  SquareIcon,
} from "@lucide/vue";
import type {
  ModelRecord,
  ReasoningEffort,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import ContextUsageMeter from "@/components/chat/composer/ContextUsageMeter.vue";
import ModelEffortPicker from "@/components/chat/composer/ModelEffortPicker.vue";

defineProps<{
  uploadingAttachments: boolean;
  selectedThreadId: string | null;
  selectedThreadTokenUsage: ThreadTokenUsageState | null;
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
  hasComposerInput: boolean;
  isThreadRunning: boolean;
  canInterruptTurn: boolean;
  canStopTurn: boolean;
  canUsePrimaryAction: boolean;
  interruptingTurn: boolean;
  selectedThreadStatus: ThreadRuntimeStatus;
  sendButtonLabel: string;
}>();

const emit = defineEmits<{
  attach: [kind: "documents" | "media"];
  primaryAction: [];
  interruptTurn: [];
  applyModelEffort: [selection: { model: string; effort: ReasoningEffort; serviceTier: string }];
}>();
</script>

<template>
  <div class="flex min-w-0 items-center gap-1.5 pt-1.5 sm:flex-wrap sm:justify-between sm:gap-2">
    <div class="flex min-w-0 items-center gap-1 text-base text-ink-muted">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            data-testid="attachment-button"
            type="button"
            variant="ghost"
            size="lg"
            class="h-9 gap-1.5 px-2.5 text-ink-muted hover:bg-canvas-soft hover:text-ink-secondary sm:size-8 sm:px-0"
            :disabled="uploadingAttachments || !selectedThreadId"
            :aria-label="$t('app.attachFile')"
            :title="$t('app.attachFile')"
          >
            <Loader2Icon v-if="uploadingAttachments" class="size-5 animate-spin" />
            <PaperclipIcon v-else class="size-4" />
            <span class="sm:hidden">{{ $t("app.attachFilesShort") }}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-56" align="start" side="top">
          <DropdownMenuItem
            data-testid="attach-documents-option"
            @select="emit('attach', 'documents')"
          >
            <FileArchiveIcon class="size-4" />
            <span class="flex min-w-0 flex-col">
              <span>{{ $t("app.attachDocuments") }}</span>
              <span class="text-[0.625rem] text-muted-foreground">{{
                $t("app.attachDocumentsHint")
              }}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="attach-media-option" @select="emit('attach', 'media')">
            <ImagePlusIcon class="size-4" />
            <span class="flex min-w-0 flex-col">
              <span>{{ $t("app.attachMedia") }}</span>
              <span class="text-[0.625rem] text-muted-foreground">{{
                $t("app.attachMediaHint")
              }}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div class="ml-auto flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
      <ContextUsageMeter :token-usage="selectedThreadTokenUsage" />
      <div class="min-w-0">
        <ModelEffortPicker
          :models="models"
          :loading-models="loadingModels"
          :active-model="activeModel"
          :active-model-label="activeModelLabel"
          :active-effort-value="activeEffortValue"
          :active-effort-compact-label="activeEffortCompactLabel"
          :active-service-tier="activeServiceTier"
          :active-service-tier-label="activeServiceTierLabel"
          :effort-options="effortOptions"
          :service-tier-options="serviceTierOptions"
          :label-effort-option="labelEffortOption"
          :model-option-value="modelOptionValue"
          @apply="emit('applyModelEffort', $event)"
        />
      </div>
      <Button
        v-if="isThreadRunning"
        data-testid="stop-turn-button"
        type="button"
        variant="outline"
        size="sm"
        class="hidden shrink-0 gap-1.5 border-primary/50 text-primary hover:bg-primary/10 sm:inline-flex"
        :aria-label="$t('app.interruptTurn')"
        :title="$t('app.interruptTurn')"
        :disabled="!canStopTurn || interruptingTurn"
        @click="emit('interruptTurn')"
      >
        <Loader2Icon v-if="interruptingTurn" class="size-4 animate-spin" />
        <SquareIcon v-else class="size-3.5 fill-current" />
        <span>{{ $t("app.interruptTurn") }}</span>
      </Button>
      <Button
        data-testid="send-turn-button"
        class="size-11 shrink-0 rounded-full bg-primary p-0 text-primary-foreground hover:bg-primary-active"
        :class="{ 'sm:hidden': canInterruptTurn }"
        :aria-label="sendButtonLabel"
        :disabled="!canUsePrimaryAction || interruptingTurn"
        @click="emit('primaryAction')"
      >
        <Loader2Icon v-if="uploadingAttachments" class="size-5 animate-spin" />
        <Loader2Icon v-else-if="interruptingTurn" class="size-5 animate-spin" />
        <SendIcon v-else-if="hasComposerInput" class="size-5" />
        <SquareIcon v-else-if="canInterruptTurn" class="size-5 fill-current" />
        <CheckIcon v-else-if="selectedThreadStatus === 'completed'" class="size-5" />
        <SendIcon v-else class="size-5 opacity-60" />
      </Button>
    </div>
  </div>
</template>
