<script setup lang="ts">
import type { ThreadTurnUsageSummary } from "~~/shared/types";

const props = defineProps<{ usage: ThreadTurnUsageSummary }>();
const { t } = useI18n();

const apiEquivalent = computed(() => {
  const micros = props.usage.apiEquivalentCostMicros;
  if (micros === null) {
    const providerUsdMicros = props.usage.providerEstimatedUsdMicros;
    if (providerUsdMicros !== null) {
      return t("app.turnUsageProviderEstimate", {
        cost: (providerUsdMicros / 1_000_000).toFixed(2),
      });
    }
    const providerCreditsMicros = props.usage.providerEstimatedCreditsMicros;
    if (providerCreditsMicros !== null) {
      return t("app.turnUsageProviderCredits", {
        credits: formatCredits(providerCreditsMicros),
      });
    }
    return t("app.turnUsageApiEquivalentUnavailable");
  }
  const dollars = micros / 1_000_000;
  const precision = dollars > 0 && dollars < 0.01 ? 4 : 2;
  return t("app.turnUsageApiEquivalent", { cost: dollars.toFixed(precision) });
});

const quota = computed(() =>
  props.usage.quotaDeltas
    .map((delta) => {
      const window = windowLabel(delta.windowDurationMins);
      const change =
        delta.deltaPercent === null
          ? delta.resetObserved
            ? t("app.turnUsageQuotaReset")
            : null
          : t("app.turnUsageQuota", {
              window,
              delta: signedPercent(delta.deltaPercent),
            });
      const utilization =
        delta.afterUsedPercent === null
          ? null
          : t("app.turnUsageQuotaUsed", {
              window,
              percent: delta.afterUsedPercent,
            });
      return [change, utilization].filter((value): value is string => value !== null).join(" ");
    })
    .filter((value) => value !== "")
    .join(" · "),
);

const details = computed(() =>
  t("app.turnUsageDetails", {
    model: props.usage.model ?? t("app.turnUsageUnknownModel"),
    input: compactTokens(props.usage.inputTokens),
    cached: compactTokens(props.usage.cachedInputTokens),
    output: compactTokens(props.usage.outputTokens),
    tier: serviceTierLabel(props.usage.serviceTier),
  }),
);

function compactTokens(value: number) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

function formatCredits(micros: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(micros / 1_000_000);
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(/\.00$/, "")} pp`;
}

function windowLabel(minutes: number | null) {
  if (minutes === null) return "quota";
  if (minutes >= 10_080) return "7d";
  if (minutes >= 1_440) return `${Math.round(minutes / 1_440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

function serviceTierLabel(value: string | null) {
  if (value?.toLowerCase() === "fast" || value?.toLowerCase() === "priority") {
    return t("app.turnUsageFast");
  }
  return t("app.turnUsageStandard");
}
</script>

<template>
  <span
    class="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint"
    data-testid="turn-usage-summary"
  >
    <span>{{ apiEquivalent }}</span>
    <span v-if="quota">{{ quota }}</span>
    <span v-if="usage.pricingCompleteness === 'partial'">{{ t("app.turnUsagePartial") }}</span>
    <span class="basis-full truncate">{{ details }}</span>
  </span>
</template>
