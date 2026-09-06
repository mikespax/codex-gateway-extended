<script setup lang="ts">
import type { RemoteGitFileStatus } from "~~/shared/types";
import { gitStatusCode, gitStatusTextClass } from "@/utils/git-status-presentation";

defineProps<{ status: RemoteGitFileStatus | null }>();
</script>

<template>
  <span
    v-if="status"
    class="shrink-0 text-xs font-semibold"
    :class="gitStatusTextClass(status)"
    :aria-label="$t(`app.fileGitStatus.${status}`)"
  >
    {{ gitStatusCode(status) }}
  </span>
</template>
