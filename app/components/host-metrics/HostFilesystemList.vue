<script setup lang="ts">
import type { HostFilesystemMetrics } from "~~/shared/types";
import { formatBytes } from "@/utils/host-metrics";

defineProps<{ filesystems: HostFilesystemMetrics[] }>();
</script>

<template>
  <div v-if="filesystems.length" class="mt-3 space-y-2 border-t border-hairline pt-3">
    <div v-for="filesystem in filesystems" :key="`${filesystem.device}:${filesystem.mountPoint}`">
      <div class="mb-1 flex min-w-0 items-center gap-2 text-xs">
        <span class="min-w-0 flex-1 truncate text-ink-secondary" :title="filesystem.mountPoint">
          {{ filesystem.mountPoint }}
        </span>
        <span class="shrink-0 tabular-nums text-ink-muted">
          {{ formatBytes(filesystem.usedBytes) }} / {{ formatBytes(filesystem.totalBytes) }}
        </span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-canvas-soft">
        <div
          class="h-full rounded-full bg-primary transition-[width]"
          :style="{ width: `${Math.min(100, filesystem.usagePercent)}%` }"
        />
      </div>
    </div>
  </div>
</template>
