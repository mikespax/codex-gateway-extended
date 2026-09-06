<script setup lang="ts">
import { DatabaseIcon, StarIcon } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import type { ThreadRuntimeStatus } from "@/stores/gateway/types";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";
import { completionAttentionClass, selectedRowClass } from "../sidebar-utils";
import SidebarRowLabel from "../SidebarRowLabel.vue";
import ThreadStatusIndicator from "./ThreadStatusIndicator.vue";
import type { SidebarThreadRow } from "../sidebar-types";
import { formatThreadSize, threadStorageTone, threadStorageToneClass } from "./thread-size";

const props = defineProps<{
  thread: SidebarThreadRow;
  testId: string;
  selected: boolean;
  status: ThreadRuntimeStatus;
  completionAttention?: boolean;
  subtitle?: string;
  resourceUsage?: string | null;
  threadBytes?: number | null;
  pinLabel: string;
  moveLabel?: string;
  moveHostLabel?: string;
  showPinnedIcon?: boolean;
  longPressHandlers?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  open: [];
  togglePin: [];
  move: [];
  moveHost: [];
  rename: [];
}>();

const pressHandlers = computed(() => props.longPressHandlers ?? {});
const formattedThreadSize = computed(() => formatThreadSize(props.threadBytes));
const threadSizeClass = computed(
  () => threadStorageToneClass[threadStorageTone(props.threadBytes)],
);
const hasSubtitle = computed(
  () =>
    (props.subtitle !== undefined && props.subtitle !== null && props.subtitle !== "") ||
    (props.resourceUsage !== undefined &&
      props.resourceUsage !== null &&
      props.resourceUsage !== "") ||
    props.threadBytes !== undefined,
);
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Button
        :data-testid="testId"
        v-bind="pressHandlers"
        :data-selected="selected ? 'true' : 'false'"
        :aria-current="selected ? 'page' : undefined"
        :data-completion-attention="completionAttention ? 'true' : 'false'"
        variant="ghost"
        class="h-auto min-h-11 w-full min-w-0 touch-manipulation justify-start overflow-hidden rounded-lg px-3 py-2.5 text-[0.9375rem] font-normal hover:bg-surface sm:min-h-9 sm:px-3 sm:py-2 sm:text-sm"
        :class="[
          selectedRowClass(selected),
          completionAttentionClass(completionAttention === true),
        ]"
        @click="emit('open')"
      >
        <SidebarRowLabel :title="titleForThread(thread)" :subtitle="hasSubtitle ? '' : undefined">
          <template #title-prefix>
            <StarIcon
              v-if="showPinnedIcon"
              class="size-3.5 shrink-0 fill-current text-accent-orange"
            />
          </template>
          <template v-if="hasSubtitle" #subtitle>
            <span v-if="props.subtitle">{{ props.subtitle }}</span>
            <span v-if="props.subtitle && props.threadBytes !== undefined"> · </span>
            <span
              v-if="props.threadBytes !== undefined"
              class="inline-flex min-w-0 items-center gap-1"
            >
              <DatabaseIcon class="size-3 shrink-0" :class="threadSizeClass" aria-hidden="true" />
              <span :class="threadSizeClass">{{ formattedThreadSize }}</span>
            </span>
            <span v-if="props.threadBytes !== undefined && props.resourceUsage"> · </span>
            <span v-if="props.resourceUsage">{{ props.resourceUsage }}</span>
          </template>
          <template #trailing>
            <ThreadStatusIndicator :status="status" :completion-attention="completionAttention" />
          </template>
        </SidebarRowLabel>
      </Button>
    </ContextMenuTrigger>
    <ContextMenuContent :collision-padding="12" prioritize-position class="w-40">
      <ContextMenuItem @select="emit('togglePin')">
        {{ pinLabel }}
      </ContextMenuItem>
      <ContextMenuItem v-if="moveLabel" @select="emit('move')">
        {{ moveLabel }}
      </ContextMenuItem>
      <ContextMenuItem v-if="moveHostLabel" @select="emit('moveHost')">
        {{ moveHostLabel }}
      </ContextMenuItem>
      <ContextMenuItem @select="emit('rename')">
        {{ $t("app.renameThread") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
