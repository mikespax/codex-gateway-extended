<script setup lang="ts">
import { Clock3Icon } from "@lucide/vue";
import { computed } from "vue";

const props = defineProps<{ value: number | string | null }>();

const timestampMs = computed(() => normalizeTimestampMs(props.value));
const isoTimestamp = computed(() =>
  timestampMs.value === null ? null : new Date(timestampMs.value).toISOString(),
);
const label = computed(() => {
  if (timestampMs.value === null) return null;
  const date = new Date(timestampMs.value);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
});
const fullLabel = computed(() => {
  if (timestampMs.value === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestampMs.value));
});

function normalizeTimestampMs(value: number | string | null) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
}
</script>

<template>
  <time
    v-if="label !== null && isoTimestamp !== null"
    data-testid="message-timestamp"
    :datetime="isoTimestamp"
    :title="fullLabel ?? undefined"
    class="inline-flex items-center gap-1 text-xs text-ink-faint"
  >
    <Clock3Icon class="size-3" />
    <span>{{ label }}</span>
  </time>
</template>
