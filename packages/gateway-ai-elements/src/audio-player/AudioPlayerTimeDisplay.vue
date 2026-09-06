<script setup lang="ts">
import type { MediaTimeDisplay } from "media-chrome";
import type { HTMLAttributes } from "vue";
import { ButtonGroupText } from "@codex-gateway/ui/button-group";
import { cn } from "@codex-gateway/ui/utils";

interface Props extends /* @vue-ignore */ Partial<MediaTimeDisplay> {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <ButtonGroupText as-child class="bg-transparent">
    <media-time-display
      :class="cn('tabular-nums', props.class)"
      data-slot="audio-player-time-display"
    />
  </ButtonGroupText>
</template>
