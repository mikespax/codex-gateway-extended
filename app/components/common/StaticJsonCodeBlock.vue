<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { computed } from "vue";
import { CodeBlock } from "@codex-gateway/ai-elements/code-block";
import { jsonPreview } from "@/utils/thread-items";

const props = withDefaults(
  defineProps<{
    value: unknown;
    maxHeight?: "compact" | "default";
    class?: HTMLAttributes["class"];
  }>(),
  {
    maxHeight: "compact",
  },
);

const code = computed(() => jsonPreview(props.value));
const heightClass = computed(() =>
  props.maxHeight === "default" ? "[&>div]:max-h-56" : "[&>div]:max-h-40",
);
</script>

<template>
  <!-- AI Elements owns static syntax highlighting and horizontal overflow here. Streaming command
       output and diffs deliberately bypass this adapter because repeatedly tokenizing them would
       contend with the outer chat virtualizer and its bottom-follow measurements. -->
  <CodeBlock
    :code="code"
    language="json"
    :class="[
      'bg-surface/80 [&_code]:text-xs [&_pre]:p-3 [&_pre]:text-xs',
      heightClass,
      props.class,
    ]"
    v-bind="$attrs"
  />
</template>
