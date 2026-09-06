<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { TabsList } from "@codex-gateway/ui/tabs";
import { cn } from "@codex-gateway/ui/utils";

type TabsListProps = InstanceType<typeof TabsList>["$props"];

interface Props extends /* @vue-ignore */ TabsListProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <TabsList
    :class="cn('h-auto rounded-none border-0 bg-transparent p-0', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </TabsList>
</template>
