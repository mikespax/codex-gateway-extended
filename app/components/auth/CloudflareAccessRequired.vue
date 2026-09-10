<script setup lang="ts">
const { t } = useI18n();

function reload() {
  window.location.reload();
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
    <section
      class="w-full max-w-sm rounded-2xl border border-hairline bg-surface p-6 text-center shadow-xl"
      data-testid="cloudflare-access-required"
    >
      <div class="space-y-2">
        <h1 class="text-xl font-semibold text-ink">{{ t("app.accessRequiredTitle") }}</h1>
        <p class="text-sm leading-6 text-ink-muted">{{ t("app.accessRequiredDescription") }}</p>
      </div>
      <div class="mt-6 flex flex-col gap-3">
        <a
          class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          href="https://codex.spax.co/"
        >
          {{ t("app.openGateway") }}
        </a>
        <button
          type="button"
          class="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
          @click="reload"
        >
          {{ t("app.retry") }}
        </button>
      </div>
    </section>
  </main>
</template>
