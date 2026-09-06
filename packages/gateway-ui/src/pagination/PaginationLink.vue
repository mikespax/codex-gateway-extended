<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import type { ButtonVariants } from "../button";
import { cn } from "../utils";
import { buttonVariants } from "../button";

const props = withDefaults(
  defineProps<{
    href?: string;
    size?: ButtonVariants["size"];
    isActive?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  {
    size: "icon",
    isActive: false,
  },
);
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    data-slot="pagination-link"
    :data-active="isActive ? '' : undefined"
    :aria-current="isActive ? 'page' : undefined"
    :class="
      cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size,
        }),
        '',
        props.class,
      )
    "
  >
    <slot />
  </a>
</template>
