<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { PauseIcon, PlayIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { Spinner } from "@codex-gateway/ui/spinner";
import { cn } from "@codex-gateway/ui/utils";

interface Props {
  class?: HTMLAttributes["class"];
  playing?: boolean;
  loading?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "play"): void;
}>();

function handleClick(event: MouseEvent) {
  event.stopPropagation();
  emit("play");
}
</script>

<template>
  <Button
    :aria-label="playing ? 'Pause preview' : 'Play preview'"
    :class="cn('size-6', props.class)"
    :disabled="loading"
    size="icon-sm"
    type="button"
    variant="outline"
    @click="handleClick"
  >
    <Spinner v-if="loading" class="size-3" />
    <PauseIcon v-else-if="playing" class="size-3" />
    <PlayIcon v-else class="size-3" />
  </Button>
</template>
