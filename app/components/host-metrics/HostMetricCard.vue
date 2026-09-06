<script setup lang="ts">
defineProps<{ title: string; value: string; subtitle?: string; testId?: string }>();
</script>

<template>
  <section
    :data-testid="testId"
    class="min-w-0 rounded-xl border border-hairline bg-surface p-4 shadow-sm"
  >
    <header class="mb-3 flex min-w-0 items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold text-ink">{{ title }}</h2>
        <p v-if="subtitle" class="mt-1 truncate text-xs text-ink-muted">{{ subtitle }}</p>
      </div>
      <strong class="shrink-0 text-lg font-semibold tabular-nums text-ink">{{ value }}</strong>
    </header>
    <slot />
  </section>
</template>
