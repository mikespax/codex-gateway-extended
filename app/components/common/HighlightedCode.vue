<script setup lang="ts">
import { computed } from "vue";
import { CheckIcon, CopyIcon } from "@lucide/vue";
import { useClipboard } from "@vueuse/core";
import { toast } from "@codex-gateway/ui/sonner";
import { useCodeHighlighter } from "@/composables/files/useCodeHighlighter";

const props = withDefaults(
  defineProps<{
    code: string;
    language?: string;
    preClass?: string;
    streaming?: boolean;
  }>(),
  {
    language: "",
    preClass: "",
    streaming: false,
  },
);

const codeRef = computed(() => props.code);
const languageRef = computed(() => props.language);
const streamingRef = computed(() => props.streaming);
const { html } = useCodeHighlighter(codeRef, languageRef, streamingRef);
const { t } = useI18n();
const { copy, copied, isSupported } = useClipboard({ source: codeRef, copiedDuring: 1200 });

async function copyCode() {
  if (!isSupported.value) {
    toast.error(t("app.copyCodeFailed"));
    return;
  }
  try {
    await copy();
    toast.success(t("app.codeCopied"));
  } catch {
    toast.error(t("app.copyCodeFailed"));
  }
}
</script>

<template>
  <div class="group/code relative">
    <button
      type="button"
      class="absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-md border border-hairline bg-surface/90 text-ink-muted shadow-sm backdrop-blur transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :title="t('app.copyCode')"
      :aria-label="t('app.copyCode')"
      @click.stop="copyCode"
    >
      <CheckIcon v-if="copied" class="size-4 text-accent-green" />
      <CopyIcon v-else class="size-4" />
    </button>
    <pre :class="preClass" v-html="html" />
  </div>
</template>
