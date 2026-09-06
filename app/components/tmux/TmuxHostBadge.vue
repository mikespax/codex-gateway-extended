<script setup lang="ts">
import IdentityBadge from "@/components/common/IdentityBadge.vue";

const props = defineProps<{
  hostId: number;
  name: string;
}>();
</script>

<template>
  <IdentityBadge :seed="String(hostId)" :label="name" />
</template>
