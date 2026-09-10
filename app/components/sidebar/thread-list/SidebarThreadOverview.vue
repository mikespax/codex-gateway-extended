<script setup lang="ts">
import { computed } from "vue";
import type { SidebarThreadOverview as SidebarThreadOverviewData } from "@/utils/thread-sidebar-summary";
import { summarizeSidebarText } from "@/utils/thread-sidebar-summary";
import SidebarActivityLabel from "./SidebarActivityLabel.vue";

const props = defineProps<{
  overview: SidebarThreadOverviewData;
}>();

const fields = [
  { key: "goal", labelKey: "app.threadSidebarGoal" },
  { key: "turnSummary", labelKey: "app.threadSidebarTurnSummary" },
  { key: "lastUserInput", labelKey: "app.threadSidebarLastUserInput" },
  { key: "currentTask", labelKey: "app.threadSidebarCurrentTask" },
] as const;

const visibleFields = computed(() =>
  fields.filter((field) => hasSidebarValue(props.overview[field.key])),
);

function displayText(field: (typeof fields)[number]) {
  const value = props.overview[field.key];
  if (field.key === "currentTask") return value ?? "—";
  return summarizeSidebarText(value) ?? "—";
}

function fullText(field: (typeof fields)[number]) {
  return props.overview[field.key] ?? "—";
}

function hasSidebarValue(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized !== "" && normalized !== "—" && normalized !== "-";
}
</script>

<template>
  <div
    data-testid="thread-sidebar-overview"
    class="grid min-w-0 gap-y-0.5 text-[0.6875rem] leading-4"
    :aria-label="$t('app.threadSidebarOverview')"
  >
    <div v-for="field in visibleFields" :key="field.key" class="flex min-w-0 items-baseline gap-1">
      <span class="shrink-0 text-ink-faint">{{ $t(field.labelKey) }}:</span>
      <SidebarActivityLabel
        :text="displayText(field)"
        :title="fullText(field)"
        :test-id="`thread-sidebar-overview-${field.key}`"
      />
    </div>
  </div>
</template>
