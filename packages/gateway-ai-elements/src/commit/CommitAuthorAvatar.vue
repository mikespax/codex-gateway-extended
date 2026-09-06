<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Avatar, AvatarFallback } from "@codex-gateway/ui/avatar";
import { cn } from "@codex-gateway/ui/utils";

type CommitAuthorAvatarProps = InstanceType<typeof Avatar>["$props"];

interface Props extends /* @vue-ignore */ CommitAuthorAvatarProps {
  class?: HTMLAttributes["class"];
  initials: string;
}

const props = defineProps<Props>();
</script>

<template>
  <Avatar :class="cn('size-8', props.class)" v-bind="$attrs">
    <AvatarFallback class="text-xs">
      {{ props.initials }}
    </AvatarFallback>
  </Avatar>
</template>
