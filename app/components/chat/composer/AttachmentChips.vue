<script setup lang="ts">
import { computed } from "vue";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@codex-gateway/ai-elements/attachments";
import type { ComposerAttachment } from "@/composables/composer/useComposerDraft";
import { presentComposerAttachment } from "./attachment-presentation";

const props = defineProps<{
  files: ComposerAttachment[];
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

const { t } = useI18n();
const presentations = computed(() => props.files.map(presentComposerAttachment));

function shortAttachmentName(name: string, maxLength = 24) {
  if (name.length <= maxLength) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";
  const stemLength = Math.max(8, maxLength - extension.length - 3);
  return `${name.slice(0, stemLength)}...${extension}`;
}
</script>

<template>
  <Attachments v-if="presentations.length" variant="grid" class="mb-2 max-w-full justify-start">
    <Attachment
      v-for="attachment in presentations"
      :key="attachment.id"
      :data="attachment.data"
      class="h-28 w-28 overflow-hidden rounded-xl border border-border bg-muted md:h-36 md:w-36"
      @remove="emit('remove', attachment.id)"
    >
      <AttachmentPreview class="size-full" />
      <div
        v-if="attachment.data.type === 'file'"
        class="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground backdrop-blur-sm"
        :title="attachment.data.filename"
      >
        {{ shortAttachmentName(attachment.data.filename ?? "") }}
      </div>
      <!-- Keep removal available without requiring a precise tiny inline target. -->
      <AttachmentRemove :label="t('app.removeAttachment')" class="opacity-100" />
    </Attachment>
  </Attachments>
</template>
