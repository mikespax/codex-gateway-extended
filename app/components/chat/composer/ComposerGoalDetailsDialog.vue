<script setup lang="ts">
import {
  LoaderCircleIcon,
  PencilIcon,
  PlayIcon,
  SaveIcon,
  SquareIcon,
  Trash2Icon,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { ThreadGoal } from "~~/shared/types";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import type { ComposerGoalPendingAction } from "@/composables/composer/useComposerGoalControls";
import { Button } from "@codex-gateway/ui/button";
import { Badge } from "@codex-gateway/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@codex-gateway/ui/dialog";
import { ScrollArea } from "@codex-gateway/ui/scroll-area";
import { Textarea } from "@codex-gateway/ui/textarea";
import {
  goalStatusI18nKey,
  threadGoalStatusControl,
  threadGoalStatusPresentation,
} from "@/utils/thread-goal-display";

const props = defineProps<{
  goal: ThreadGoal;
  elapsedLabel: string;
  tokensLabel: string;
  budgetLabel: string;
  pendingAction: ComposerGoalPendingAction | null;
}>();

const emit = defineEmits<{
  save: [objective: string];
  stop: [];
  resume: [];
  clear: [];
}>();

const open = ref(false);
const editing = ref(false);
const objectiveDraft = ref("");
const { t } = useI18n();
const normalizedObjective = computed(() => objectiveDraft.value.trim());
const statusControl = computed(() => threadGoalStatusControl(props.goal.status));
const statusLabel = computed(() => t(goalStatusI18nKey(props.goal.status)));
const statusPresentation = computed(() => threadGoalStatusPresentation(props.goal.status));
const canSave = computed(
  () =>
    props.pendingAction === null &&
    normalizedObjective.value.length > 0 &&
    normalizedObjective.value !== props.goal.objective.trim(),
);

function beginEditing() {
  objectiveDraft.value = props.goal.objective;
  editing.value = true;
}

function cancelEditing() {
  objectiveDraft.value = props.goal.objective;
  editing.value = false;
}

function saveGoal() {
  if (!canSave.value) return;
  emit("save", normalizedObjective.value);
}

watch(open, (isOpen) => {
  if (isOpen) objectiveDraft.value = props.goal.objective;
  else editing.value = false;
});

watch(
  () => props.goal.objective,
  (objective) => {
    objectiveDraft.value = objective;
    // The store updates the Goal while the shared mutation guard still reports `set`. Closing the
    // editor on that semantic commit keeps a failed request editable and avoids timing assumptions.
    if (props.pendingAction === "set") editing.value = false;
  },
);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <button
        type="button"
        data-testid="composer-goal-summary"
        :data-goal-status="goal.status"
        class="gateway-goal-summary flex w-full min-w-0 items-center gap-3 rounded-2xl border px-3 py-2 text-left text-sm text-ink shadow-sm shadow-ink/5 transition md:text-base"
        :class="statusPresentation.triggerClass"
      >
        <span class="shrink-0 font-medium" :class="statusPresentation.labelClass">
          {{ $t("app.goalModeActive") }}
        </span>
        <span class="min-w-0 flex-1 truncate text-ink-secondary">{{ goal.objective }}</span>
        <Badge variant="outline" class="shrink-0" :class="statusPresentation.badgeClass">
          {{ statusLabel }}
        </Badge>
        <span
          class="flex shrink-0 flex-col items-end gap-0.5 font-mono text-xs text-ink-muted sm:flex-row sm:items-center sm:gap-2"
        >
          <span>{{ elapsedLabel }}</span>
          <span>{{ tokensLabel }}</span>
        </span>
      </button>
    </DialogTrigger>

    <DialogContent
      data-testid="goal-details-dialog"
      class="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] !max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 sm:h-[min(54rem,calc(100dvh-3rem))] sm:w-[min(70rem,calc(100vw-3rem))] sm:!max-w-[min(70rem,calc(100vw-3rem))]"
    >
      <DialogHeader class="shrink-0 border-b border-hairline px-4 py-3 text-left sm:px-6 sm:py-5">
        <DialogTitle class="text-lg">{{ $t("app.goalDetailsTitle") }}</DialogTitle>
        <DialogDescription class="hidden sm:block">
          {{ $t("app.goalDetailsDescription") }}
        </DialogDescription>
      </DialogHeader>

      <div
        class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3 sm:gap-4 sm:px-6 sm:py-5"
      >
        <div
          data-testid="goal-details-objective"
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-canvas-soft sm:rounded-2xl"
        >
          <div
            class="shrink-0 border-b border-hairline px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted sm:py-3"
          >
            {{ $t("app.goalObjective") }}
          </div>
          <Textarea
            v-if="editing"
            v-model="objectiveDraft"
            data-testid="goal-details-objective-input"
            :aria-label="$t('app.goalObjective')"
            class="h-full min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-3 text-sm shadow-none focus-visible:ring-0 sm:p-4"
            :disabled="pendingAction !== null"
          />
          <ScrollArea v-else class="min-h-0 flex-1">
            <div class="p-3 pr-5 sm:p-4 sm:pr-6">
              <MarkdownContent :content="goal.objective" compact />
            </div>
          </ScrollArea>
        </div>

        <!--
          Mobile reserves the flexible height for the objective. Keep metrics in one compact strip
          instead of stacking three desktop cards; otherwise short browser visual viewports leave
          only a single text line for the actual Goal. The desktop breakpoint restores card gaps.
        -->
        <dl
          data-testid="goal-details-stats"
          class="grid shrink-0 grid-cols-3 divide-x divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface sm:gap-3 sm:divide-x-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent"
        >
          <div class="min-w-0 p-2 sm:rounded-2xl sm:border sm:border-hairline sm:bg-surface sm:p-3">
            <dt class="text-xs text-ink-muted">{{ $t("app.goalElapsed") }}</dt>
            <dd
              class="mt-1 break-all font-mono text-xs leading-tight text-ink sm:break-normal sm:text-sm"
              :title="elapsedLabel"
            >
              {{ elapsedLabel }}
            </dd>
          </div>
          <div class="min-w-0 p-2 sm:rounded-2xl sm:border sm:border-hairline sm:bg-surface sm:p-3">
            <dt class="text-xs text-ink-muted">{{ $t("app.goalTokensUsed") }}</dt>
            <dd
              class="mt-1 break-all font-mono text-xs leading-tight text-ink sm:break-normal sm:text-sm"
              :title="tokensLabel"
            >
              {{ tokensLabel }}
            </dd>
          </div>
          <div class="min-w-0 p-2 sm:rounded-2xl sm:border sm:border-hairline sm:bg-surface sm:p-3">
            <dt class="text-xs text-ink-muted">{{ $t("app.goalTokenBudget") }}</dt>
            <dd
              class="mt-1 break-all font-mono text-xs leading-tight text-ink sm:break-normal sm:text-sm"
              :title="budgetLabel"
            >
              {{ budgetLabel }}
            </dd>
          </div>
        </dl>
      </div>

      <DialogFooter
        data-testid="goal-details-footer"
        class="grid shrink-0 gap-2 border-t border-hairline px-4 py-3 sm:flex sm:px-6 sm:py-4 sm:items-center sm:justify-between"
        :class="statusControl === null ? 'grid-cols-2' : 'grid-cols-3'"
      >
        <Button
          type="button"
          variant="destructive"
          class="order-3 min-w-0 px-1 sm:order-none sm:px-2"
          data-testid="goal-details-clear"
          :disabled="pendingAction !== null"
          @click="emit('clear')"
        >
          <LoaderCircleIcon v-if="pendingAction === 'clear'" class="size-4 animate-spin" />
          <Trash2Icon v-else class="size-4" />
          {{ $t("app.slashGoalClearTitle") }}
        </Button>
        <!-- `contents` makes the two context actions peers of Clear in the mobile three-column
             toolbar; desktop restores the original grouped action row without duplicate controls. -->
        <div class="contents sm:flex sm:flex-row sm:gap-2">
          <template v-if="editing">
            <Button
              type="button"
              variant="outline"
              class="order-1 min-w-0 px-1 sm:order-none sm:px-2"
              data-testid="goal-details-edit-cancel"
              :disabled="pendingAction !== null"
              @click="cancelEditing"
            >
              {{ $t("app.cancel") }}
            </Button>
            <Button
              type="button"
              class="order-2 min-w-0 px-1 sm:order-none sm:px-2"
              data-testid="goal-details-edit-save"
              :disabled="!canSave"
              @click="saveGoal"
            >
              <LoaderCircleIcon v-if="pendingAction === 'set'" class="size-4 animate-spin" />
              <SaveIcon v-else class="size-4" />
              {{ $t("app.save") }}
            </Button>
          </template>
          <template v-else>
            <Button
              v-if="statusControl === 'pause'"
              type="button"
              variant="outline"
              class="order-2 min-w-0 px-1 sm:order-none sm:px-2"
              data-testid="goal-details-stop"
              :disabled="pendingAction !== null"
              @click="emit('stop')"
            >
              <LoaderCircleIcon v-if="pendingAction === 'pause'" class="size-4 animate-spin" />
              <SquareIcon v-else class="size-4" />
              {{ $t("app.goalStop") }}
            </Button>
            <Button
              v-else-if="statusControl === 'resume'"
              type="button"
              variant="outline"
              class="order-2 min-w-0 px-1 sm:order-none sm:px-2"
              data-testid="goal-details-resume"
              :disabled="pendingAction !== null"
              @click="emit('resume')"
            >
              <LoaderCircleIcon v-if="pendingAction === 'resume'" class="size-4 animate-spin" />
              <PlayIcon v-else class="size-4" />
              {{ $t("app.slashGoalResumeTitle") }}
            </Button>
            <Button
              type="button"
              class="order-1 min-w-0 px-1 sm:order-none sm:px-2"
              data-testid="goal-details-edit"
              :disabled="pendingAction !== null"
              @click="beginEditing"
            >
              <PencilIcon class="size-4" />
              {{ $t("app.slashGoalEditTitle") }}
            </Button>
          </template>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
