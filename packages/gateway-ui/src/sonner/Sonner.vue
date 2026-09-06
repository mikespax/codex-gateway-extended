<script lang="ts" setup>
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
  XIcon,
} from "@lucide/vue";

import type { ToasterProps } from "vue-sonner";
import { reactiveOmit } from "@vueuse/core";
import { Toaster as Sonner } from "vue-sonner";
import { cn } from "../utils";

const props = defineProps<ToasterProps>();
const delegatedProps = reactiveOmit(props, "class", "toastOptions");
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'hsl(var(--popover) / 0.9)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="{
      classes: {
        toast: 'max-h-48 overflow-hidden rounded-md max-sm:flex-wrap max-sm:items-start',
        content: 'min-w-0 flex-1',
        title: 'max-h-32 overflow-auto whitespace-pre-wrap break-words',
        description: 'max-h-24 overflow-auto whitespace-pre-wrap break-words',
        actionButton:
          'max-sm:mt-2! max-sm:ml-0! max-sm:h-8! max-sm:basis-full max-sm:justify-center max-sm:whitespace-normal',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
