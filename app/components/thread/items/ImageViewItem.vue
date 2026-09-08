<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { ImageIcon } from "@lucide/vue";
import { computed } from "vue";
import ThreadImageReferences from "@/components/thread/attachments/ThreadImageReferences.vue";
import { threadImageReferences } from "@/utils/thread-images";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  showInlineImages?: boolean;
}>();

const { t } = useI18n();

const references = computed(() => threadImageReferences(props.item));
const label = computed(
  () => references.value[0]?.path || references.value[0]?.label || t("app.imageView"),
);
</script>

<template>
  <div class="max-w-4xl text-ink-secondary">
    <div class="mb-2 flex items-center gap-2 text-[0.9375rem]">
      <ImageIcon class="size-4 shrink-0" />
      <span class="min-w-0 truncate">{{ label }}</span>
    </div>
    <div class="max-w-3xl">
      <ThreadImageReferences
        :item="item"
        :host-id="hostId"
        :show="props.showInlineImages === true"
      />
      <div
        v-if="references.length === 0"
        class="flex min-h-20 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted"
      >
        <ImageIcon class="size-4 shrink-0" />
        <span class="min-w-0 truncate">{{ label }}</span>
      </div>
    </div>
  </div>
</template>
