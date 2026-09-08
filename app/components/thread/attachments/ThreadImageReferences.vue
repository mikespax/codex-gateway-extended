<script setup lang="ts">
import { computed } from "vue";
import ThreadImageAttachment from "@/components/thread/attachments/ThreadImageAttachment.vue";
import { threadImageReferences, threadImageSource } from "@/utils/thread-images";
import type { ThreadHistoryItem } from "~~/shared/types";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  max?: number;
}>();

const references = computed(() => threadImageReferences(props.item).slice(0, props.max ?? 4));
const images = computed(() =>
  references.value
    .map((reference) => ({
      ...reference,
      source: threadImageSource(reference, props.hostId),
    }))
    .filter((reference) => reference.source !== ""),
);
</script>

<template>
  <div v-if="images.length" class="grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
    <ThreadImageAttachment
      v-for="image in images"
      :key="image.id"
      :source="image.source"
      :label="image.label"
      :detail="image.detail"
    />
  </div>
</template>
