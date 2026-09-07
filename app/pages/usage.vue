<script setup lang="ts">
import { ArrowLeftIcon, GaugeIcon, RefreshCwIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  UsageDashboardSummary,
  UsagePeriodSummary,
  UsageQuotaSnapshot,
} from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";

const { locale, t } = useI18n();
const dashboard = ref<UsageDashboardSummary | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const error = ref("");
let requestGeneration = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const monthlyRows = computed(() => [...(dashboard.value?.monthly ?? [])].reverse());
const weeklyRows = computed(() => [...(dashboard.value?.weekly ?? [])].reverse());
const monthlyMax = computed(() => maxCost(monthlyRows.value));
const weeklyMax = computed(() => maxCost(weeklyRows.value));
const weeklyWindow = computed(() =>
  (dashboard.value?.quotaWindows ?? []).find(
    (window) => window.windowDurationMins !== null && window.windowDurationMins >= 10_080,
  ),
);
const shortWindow = computed(() =>
  (dashboard.value?.quotaWindows ?? []).find(
    (window) => window.windowDurationMins !== null && window.windowDurationMins < 10_080,
  ),
);
const updatedLabel = computed(() => {
  const generatedAt = dashboard.value?.generatedAt;
  return generatedAt === undefined
    ? null
    : new Date(generatedAt).toLocaleTimeString(locale.value, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
});

async function refresh() {
  const generation = ++requestGeneration;
  refreshing.value = true;
  error.value = "";
  try {
    const next = await gatewayApi<UsageDashboardSummary>("/api/usage/overview");
    if (generation === requestGeneration) dashboard.value = next;
  } catch (cause) {
    if (generation === requestGeneration && dashboard.value === null) {
      error.value = cause instanceof Error ? cause.message : t("usage.refreshFailed");
    }
  } finally {
    if (generation === requestGeneration) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") void refresh();
}

onMounted(() => {
  void refresh();
  refreshTimer = setInterval(() => void refresh(), 30_000);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (refreshTimer !== null) clearInterval(refreshTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

function formatUsd(micros: number | null | undefined) {
  if (micros === null || micros === undefined) return t("usage.unavailable");
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatTokens(tokens: number) {
  return new Intl.NumberFormat(locale.value, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(tokens);
}

function formatRatio(ratio: number | null) {
  return ratio === null ? t("usage.notConfigured") : `${ratio.toFixed(2)}x`;
}

function formatPeriod(period: UsagePeriodSummary, kind: "month" | "week") {
  const start = new Date(period.periodStart);
  if (kind === "month") {
    return start.toLocaleDateString(locale.value, { month: "short", year: "numeric" });
  }
  return `${start.toLocaleDateString(locale.value, { month: "short", day: "numeric" })}–${new Date(
    new Date(period.periodEnd).getTime() - 1,
  ).toLocaleDateString(locale.value, { month: "short", day: "numeric" })}`;
}

function barWidth(period: UsagePeriodSummary, max: number) {
  if (period.pricedTurnCount <= 0 || period.apiEquivalentCostMicros <= 0 || max <= 0) return "0%";
  return `${Math.max(4, Math.round((period.apiEquivalentCostMicros / max) * 100))}%`;
}

function periodCost(period: UsagePeriodSummary) {
  return period.pricedTurnCount === 0
    ? t("usage.unavailable")
    : formatUsd(period.apiEquivalentCostMicros);
}

function maxCost(periods: UsagePeriodSummary[]) {
  return periods.reduce((max, period) => Math.max(max, period.apiEquivalentCostMicros), 0);
}

function quotaLabel(window: UsageQuotaSnapshot) {
  const minutes = window.windowDurationMins;
  if (minutes !== null && minutes >= 10_080) return t("usage.sevenDay");
  if (minutes !== null && minutes >= 60)
    return t("usage.hours", { count: Math.round(minutes / 60) });
  return window.key;
}

function resetLabel(window: UsageQuotaSnapshot) {
  return window.resetsAt === null
    ? t("usage.resetUnknown")
    : t("usage.resets", { value: new Date(window.resetsAt * 1000).toLocaleString(locale.value) });
}

function quotaTone(window: UsageQuotaSnapshot) {
  if (window.usedPercent >= 85) return "text-destructive";
  if (window.usedPercent >= 60) return "text-accent-orange-deep";
  return "text-accent-green";
}
</script>

<template>
  <main class="min-h-[100dvh] overflow-y-auto bg-canvas-soft px-4 py-5 text-ink sm:px-8 sm:py-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <NuxtLink
            to="/"
            class="grid size-9 shrink-0 place-items-center rounded-xl border border-hairline bg-surface text-ink-muted transition hover:text-ink"
            :title="$t('usage.backToGateway')"
            :aria-label="$t('usage.backToGateway')"
          >
            <ArrowLeftIcon class="size-4" />
          </NuxtLink>
          <div class="min-w-0">
            <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {{ $t("usage.title") }}
            </h1>
            <p class="text-sm text-ink-muted">{{ $t("usage.subtitle") }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <span v-if="updatedLabel">{{ $t("usage.updated", { value: updatedLabel }) }}</span>
          <button
            type="button"
            class="grid size-9 place-items-center rounded-xl border border-hairline bg-surface transition hover:text-ink disabled:opacity-50"
            :disabled="refreshing"
            :title="$t('usage.refresh')"
            :aria-label="$t('usage.refresh')"
            @click="refresh"
          >
            <RefreshCwIcon class="size-4" :class="{ 'animate-spin': refreshing }" />
          </button>
        </div>
      </header>

      <div
        v-if="loading && dashboard === null"
        class="rounded-2xl border border-hairline bg-surface p-8 text-center text-sm text-ink-muted"
      >
        {{ $t("usage.loading") }}
      </div>
      <div
        v-else-if="error !== '' && dashboard === null"
        class="rounded-2xl border border-destructive/30 bg-surface p-8 text-center text-sm text-destructive"
      >
        {{ error }}
      </div>

      <template v-else-if="dashboard !== null">
        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article class="rounded-2xl border border-hairline bg-surface p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {{ $t("usage.monthApiValue") }}
            </p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">
              {{ formatUsd(dashboard.thisMonth.apiEquivalentCostMicros) }}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              {{
                $t("usage.since", {
                  value: new Date(dashboard.thisMonth.periodStart).toLocaleDateString(locale, {
                    dateStyle: "medium",
                  }),
                })
              }}
            </p>
          </article>

          <article class="rounded-2xl border border-hairline bg-surface p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {{ $t("usage.subscriptionPayback") }}
            </p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">
              {{ formatRatio(dashboard.thisMonth.paybackRatio) }}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              <template v-if="dashboard.thisMonth.subscriptionPriceMicros !== null">
                {{
                  $t("usage.subscriptionConfigured", {
                    value: formatUsd(dashboard.thisMonth.subscriptionPriceMicros),
                  })
                }}
              </template>
              <template v-else>{{ $t("usage.subscriptionMissing") }}</template>
            </p>
          </article>

          <article class="rounded-2xl border border-hairline bg-surface p-5">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {{ $t("usage.weeklyUtilization") }}
              </p>
              <GaugeIcon class="size-4 text-ink-muted" />
            </div>
            <template v-if="weeklyWindow !== undefined">
              <p class="mt-2 text-2xl font-semibold tabular-nums" :class="quotaTone(weeklyWindow)">
                {{ weeklyWindow.usedPercent.toFixed(1) }}%
              </p>
              <p class="mt-1 text-xs text-ink-muted">
                {{
                  $t("usage.usedRemaining", { remaining: weeklyWindow.remainingPercent.toFixed(1) })
                }}
                · {{ resetLabel(weeklyWindow) }}
              </p>
            </template>
            <p v-else class="mt-2 text-sm text-ink-muted">{{ $t("usage.weeklyUnavailable") }}</p>
          </article>

          <article class="rounded-2xl border border-hairline bg-surface p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {{ $t("usage.hostCoverage") }}
            </p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">
              {{ dashboard.liveHostCount }}/{{
                dashboard.liveHostCount + dashboard.failedHostCount
              }}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              {{ $t("usage.hostCoverageDetail", { failed: dashboard.failedHostCount }) }}
            </p>
          </article>
        </section>

        <section class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <article class="rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold">{{ $t("usage.monthlyHistory") }}</h2>
                <p class="mt-1 text-xs text-ink-muted">{{ $t("usage.apiEquivalentNote") }}</p>
              </div>
              <span class="text-xs text-ink-muted">{{
                $t("usage.turns", {
                  count: monthlyRows.reduce((sum, row) => sum + row.turnCount, 0),
                })
              }}</span>
            </div>
            <div v-if="monthlyRows.length === 0" class="py-12 text-center text-sm text-ink-muted">
              {{ $t("usage.noData") }}
            </div>
            <div v-else class="mt-5 space-y-4">
              <div v-for="row in monthlyRows" :key="row.periodStart" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3 text-xs">
                  <span class="font-medium">{{ formatPeriod(row, "month") }}</span>
                  <span class="tabular-nums text-ink-muted">{{ periodCost(row) }}</span>
                </div>
                <div
                  v-if="row.pricedTurnCount > 0"
                  class="h-2 overflow-hidden rounded-full bg-canvas-soft"
                  :aria-label="periodCost(row)"
                >
                  <div
                    class="h-full rounded-full bg-primary/75"
                    :style="{ width: barWidth(row, monthlyMax) }"
                  />
                </div>
                <div
                  v-else
                  class="flex h-2 items-center rounded-full border border-dashed border-ink-muted/40 bg-canvas-soft"
                  role="img"
                  :aria-label="$t('usage.periodUnavailable')"
                />
                <p class="text-[0.6875rem] text-ink-muted">
                  {{
                    $t("usage.periodDetail", {
                      turns: row.turnCount,
                      priced: row.pricedTurnCount,
                      tokens: formatTokens(row.totalTokens),
                    })
                  }}
                </p>
              </div>
            </div>
          </article>

          <article class="rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold">{{ $t("usage.weeklyHistory") }}</h2>
                <p class="mt-1 text-xs text-ink-muted">{{ $t("usage.weeklyHistoryNote") }}</p>
              </div>
              <span v-if="shortWindow !== undefined" class="text-xs text-ink-muted">
                {{ quotaLabel(shortWindow) }}: {{ shortWindow.usedPercent.toFixed(1) }}%
              </span>
            </div>
            <div v-if="weeklyRows.length === 0" class="py-12 text-center text-sm text-ink-muted">
              {{ $t("usage.noData") }}
            </div>
            <div v-else class="mt-5 space-y-4">
              <div v-for="row in weeklyRows" :key="row.periodStart" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3 text-xs">
                  <span class="font-medium">{{ formatPeriod(row, "week") }}</span>
                  <span class="tabular-nums text-ink-muted">{{ periodCost(row) }}</span>
                </div>
                <div
                  v-if="row.pricedTurnCount > 0"
                  class="h-2 overflow-hidden rounded-full bg-canvas-soft"
                  :aria-label="periodCost(row)"
                >
                  <div
                    class="h-full rounded-full bg-accent-green/75"
                    :style="{ width: barWidth(row, weeklyMax) }"
                  />
                </div>
                <div
                  v-else
                  class="flex h-2 items-center rounded-full border border-dashed border-ink-muted/40 bg-canvas-soft"
                  role="img"
                  :aria-label="$t('usage.periodUnavailable')"
                />
                <p class="text-[0.6875rem] text-ink-muted">
                  {{
                    $t("usage.periodDetail", {
                      turns: row.turnCount,
                      priced: row.pricedTurnCount,
                      tokens: formatTokens(row.totalTokens),
                    })
                  }}
                </p>
              </div>
            </div>
          </article>
        </section>

        <p class="text-xs leading-relaxed text-ink-muted">
          {{ $t("usage.disclaimer") }}
        </p>
      </template>
    </div>
  </main>
</template>
