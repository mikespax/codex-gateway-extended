<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ListTreeIcon } from "@lucide/vue";
import { Loader } from "@codex-gateway/ai-elements/loader";
import { Badge } from "@codex-gateway/ui/badge";
import TurnElapsedPill from "@/components/thread/TurnElapsedPill.vue";

const props = defineProps<{
  open: boolean;
  count: number;
  preview?: string;
  segmentNumber?: number;
  segmentCount?: number;
  working?: boolean;
  startedAt?: number | null;
  latestOperation?: string | null;
  footer?: boolean;
}>();

const emit = defineEmits<{
  toggle: [open: boolean];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="w-full max-w-4xl">
    <button
      type="button"
      class="flex w-full items-start gap-2 rounded-md bg-canvas-soft px-3 py-2 text-left text-sm text-ink-secondary hover:bg-surface"
      :class="
        props.footer ? 'items-center justify-center border border-hairline bg-transparent' : ''
      "
      :aria-expanded="open"
      :data-state="open ? 'open' : 'closed'"
      :data-testid="open ? 'intermediate-steps' : undefined"
      @click="emit('toggle', !props.open)"
    >
      <ChevronUpIcon v-if="props.footer" class="size-4 shrink-0 text-ink-faint" />
      <ChevronDownIcon v-else-if="open" class="size-4 shrink-0 text-ink-faint" />
      <ChevronRightIcon v-else class="size-4 shrink-0 text-ink-faint" />
      <Loader v-if="!props.footer && props.working" class="size-4 shrink-0 text-primary" />
      <ListTreeIcon v-else-if="!props.footer" class="size-4 shrink-0 text-ink-faint" />
      <span v-if="props.footer" class="min-w-0 truncate">{{
        t("app.collapseIntermediateSteps")
      }}</span>
      <span v-else class="min-w-0 flex-1">
        <span class="block truncate font-medium">
          {{ t("app.intermediateSteps") }}
          <span v-if="(props.segmentCount ?? 0) > 1" class="text-ink-faint">
            · {{ props.segmentNumber }}/{{ props.segmentCount }}
          </span>
        </span>
        <span
          v-if="props.working"
          data-testid="intermediate-steps-working"
          class="mt-0.5 block truncate text-xs leading-4 text-ink-faint"
        >
          {{ t("app.working") }}
        </span>
        <span
          v-if="props.working && props.latestOperation"
          data-testid="intermediate-latest-operation-header"
          class="block truncate text-xs leading-4 text-ink-faint"
          :title="props.latestOperation"
        >
          {{ props.latestOperation }}
        </span>
        <span
          v-else-if="!props.working && props.preview"
          data-testid="intermediate-steps-preview"
          class="mt-0.5 line-clamp-2 text-xs leading-4 text-ink-faint md:line-clamp-1"
        >
          {{ props.preview }}
        </span>
      </span>
      <TurnElapsedPill
        v-if="!props.footer && props.working"
        :started-at="props.startedAt ?? null"
        test-id="intermediate-header-duration"
      />
      <Badge v-if="!props.footer && count > 0" variant="outline">{{ count }}</Badge>
    </button>
  </div>
</template>
