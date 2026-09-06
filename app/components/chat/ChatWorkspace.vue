<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { workspaceLayoutScopeKey } from "@/stores/gateway-workspace-layout";
import WorkspaceDock from "./workspace-dock/WorkspaceDock.vue";

withDefaults(
  defineProps<{
    layout?: "desktop" | "mobile";
  }>(),
  {
    layout: "desktop",
  },
);

const { selectedHostId, selectedProjectId, selectedThreadId } = storeToRefs(
  useGatewayNavigationStore(),
);
const scopeKey = computed(() =>
  workspaceLayoutScopeKey(selectedHostId.value, selectedProjectId.value, selectedThreadId.value),
);
</script>

<template>
  <section class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
    <!--
      A Dockview renderer="always" tree is intentionally persistent while panels move inside one
      workspace. It must not cross a Host/Project/Thread boundary: Dockview reuses overlay nodes by
      panel id, while Agent virtual measurements and scroll ownership are thread-scoped. Keying the
      owner lets Vue finish the old unmount before creating the target layout, instead of racing a
      removePanel()/fromJSON() transaction inside one Dockview instance.
    -->
    <WorkspaceDock :key="scopeKey" :layout="layout">
      <template #mobile-header-start>
        <slot name="mobile-header-start" />
      </template>
    </WorkspaceDock>
  </section>
</template>
