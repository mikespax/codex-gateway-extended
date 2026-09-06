<script setup lang="ts">
import { computed } from "vue";
import { Message, MessageContent } from "@codex-gateway/ai-elements/message";
import { Badge } from "@codex-gateway/ui/badge";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import ThreadImageAttachment from "@/components/thread/attachments/ThreadImageAttachment.vue";
import MessageTimestamp from "@/components/thread/MessageTimestamp.vue";
import { threadItemText } from "@/utils/thread-items";
import type { ThreadHistoryItem } from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  variant?: "normal" | "steer";
  sentAt?: number | string | null;
}>();

const { t } = useI18n();
const text = computed(() => threadItemText(props.item));
type ImagePart = Record<string, unknown> & { type: "image" | "localImage" };

function isImagePart(part: Record<string, unknown> | null): part is ImagePart {
  return part?.type === "image" || part?.type === "localImage";
}

const imageParts = computed(() => {
  if (!Array.isArray(props.item.content)) {
    return [];
  }
  return props.item.content
    .map(recordFromUnknown)
    .filter(isImagePart)
    .map((part, index: number) => ({
      id: `${props.item.id || props.item.clientId || "image"}-${index}`,
      type: part.type,
      url: typeof part.url === "string" ? part.url : "",
      path: typeof part.path === "string" ? part.path : "",
      detail: typeof part.detail === "string" ? part.detail : null,
    }));
});

function imageSource(image: { type: string; url: string; path: string }) {
  if (image.type === "image") {
    return image.url;
  }
  if (image.type === "localImage" && props.hostId && image.path) {
    const query = new URLSearchParams({
      hostId: String(props.hostId),
      path: image.path,
    });
    return `/api/remote/images?${query.toString()}`;
  }
  return "";
}
</script>

<template>
  <Message from="user" class="min-w-0 max-w-full">
    <MessageContent
      :data-testid="variant === 'steer' ? 'steered-conversation-item' : undefined"
      :class="[
        'thread-user-message min-w-0 max-w-full space-y-3 px-4 py-4 leading-7 text-ink group-[.is-user]:py-4 group-[.is-user]:text-ink md:max-w-3xl md:px-5 md:group-[.is-user]:px-5',
        variant === 'steer'
          ? 'rounded-xl border border-primary/20 bg-primary/5 group-[.is-user]:rounded-xl group-[.is-user]:border group-[.is-user]:border-primary/20 group-[.is-user]:bg-primary/5'
          : 'rounded-2xl bg-canvas-soft group-[.is-user]:rounded-2xl group-[.is-user]:bg-canvas-soft',
      ]"
      style="font-size: var(--chat-message-font-size, 0.9375rem)"
    >
      <div
        v-if="variant === 'steer'"
        class="flex items-center gap-2 text-sm font-medium text-primary"
      >
        <Badge variant="outline" class="border-primary/30 bg-surface/60 text-primary">{{
          t("app.steeredConversation")
        }}</Badge>
      </div>
      <div v-if="imageParts.length" class="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        <template v-for="image in imageParts" :key="image.id">
          <ThreadImageAttachment
            v-if="imageSource(image)"
            :source="imageSource(image)"
            :label="image.path || null"
            :detail="image.detail"
          />
        </template>
      </div>
      <MarkdownContent v-if="text" :content="text" compact />
      <div v-if="props.sentAt != null" class="flex justify-end">
        <MessageTimestamp :value="props.sentAt" />
      </div>
    </MessageContent>
  </Message>
</template>

<style scoped>
.thread-user-message :deep(.markdown-content),
.thread-user-message :deep(.markdown-content p),
.thread-user-message :deep(.markdown-content li),
.thread-user-message :deep(.markdown-content code),
.thread-user-message :deep(.markdown-content a) {
  overflow-wrap: anywhere;
}
</style>
