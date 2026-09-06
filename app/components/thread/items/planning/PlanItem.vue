<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { computed } from "vue";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import { threadItemText } from "@/utils/thread-items";
import CodexPlanCard from "./CodexPlanCard.vue";
import PlanImplementationActions from "./PlanImplementationActions.vue";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  threadId: string | null;
}>();
const { t } = useI18n();
const text = computed(() => threadItemText(props.item));
</script>

<template>
  <CodexPlanCard :title="t('app.plan')">
    <MarkdownContent :content="text" />
    <template #footer>
      <PlanImplementationActions :item="item" :host-id="hostId" :thread-id="threadId" />
    </template>
  </CodexPlanCard>
</template>
