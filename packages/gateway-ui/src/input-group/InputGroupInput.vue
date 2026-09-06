<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../utils";
import { Input } from "../input";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <Input
    data-slot="input-group-control"
    :class="
      cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0',
        props.class,
      )
    "
  />
</template>
