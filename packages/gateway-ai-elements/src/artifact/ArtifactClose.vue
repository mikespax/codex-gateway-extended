<script setup lang="ts">
import type { ButtonVariants } from "@codex-gateway/ui/button";
import type { HTMLAttributes } from "vue";
import { X } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { cn } from "@codex-gateway/ui/utils";
import { computed } from "vue";

interface ArtifactCloseProps {
  class?: HTMLAttributes["class"];
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
}

const props = withDefaults(defineProps<ArtifactCloseProps>(), {
  variant: "ghost",
  size: "sm",
});

const classes = computed(() =>
  cn("size-8 p-0 text-muted-foreground hover:text-foreground", props.class),
);
</script>

<template>
  <Button
    type="button"
    v-bind="{
      ...props,
      class: classes,
    }"
  >
    <slot>
      <X class="size-4" />
    </slot>
    <span class="sr-only">Close</span>
  </Button>
</template>
