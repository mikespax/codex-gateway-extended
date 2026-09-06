<script setup lang="ts">
import { toRef } from "vue";
import HostTreeNode from "./HostTreeNode.vue";
import { HOST_TREE_CONTROLLER, type HostTreeController } from "./controller";

const props = defineProps<{ controller: HostTreeController; showHeader?: boolean }>();
provide(HOST_TREE_CONTROLLER, toRef(props, "controller"));
</script>

<template>
  <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <div v-if="props.showHeader !== false" class="px-2 pb-2 text-sm text-ink-muted">
      {{ $t("app.hosts") }}
    </div>
    <div class="min-w-0 space-y-1 overflow-hidden">
      <HostTreeNode v-for="host in controller.hosts" :key="host.id" :host="host" />
    </div>
  </section>
</template>
