<script setup lang="ts">
import { AlertTriangleIcon, XIcon } from "@lucide/vue";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@codex-gateway/ui/alert";
import { Button } from "@codex-gateway/ui/button";
import type { BrowserPreviewResourceFailure } from "~~/shared/types";

defineProps<{ failures: BrowserPreviewResourceFailure[] }>();
defineEmits<{ dismiss: [] }>();
</script>

<template>
  <Alert variant="destructive" class="shrink-0 rounded-none border-x-0 border-t-0 px-3 py-2 pr-12">
    <AlertTriangleIcon />
    <AlertTitle>{{ $t("app.browserResourceLoadFailed", { count: failures.length }) }}</AlertTitle>
    <AlertDescription class="min-w-0 space-y-1">
      <p>{{ $t("app.browserResourceLoadFailedHint") }}</p>
      <div class="flex max-h-20 flex-col gap-0.5 overflow-auto font-mono">
        <span v-for="failure in failures" :key="`${failure.statusCode}:${failure.path}`">
          {{ failure.statusCode }} {{ failure.method }} {{ failure.path }}
        </span>
      </div>
    </AlertDescription>
    <AlertAction>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="$t('app.close')"
        @click="$emit('dismiss')"
      >
        <XIcon class="size-4" />
      </Button>
    </AlertAction>
  </Alert>
</template>
