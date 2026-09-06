<script setup lang="ts">
import type { MediaPlayButton } from "media-chrome";
import type { HTMLAttributes } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { cn } from "@codex-gateway/ui/utils";

interface Props extends /* @vue-ignore */ Partial<MediaPlayButton> {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <Button as-child size="icon-sm" variant="outline">
    <media-play-button
      :class="cn('bg-transparent', props.class)"
      data-slot="audio-player-play-button"
    />
  </Button>
</template>
