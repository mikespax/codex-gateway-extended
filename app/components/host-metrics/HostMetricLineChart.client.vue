<script setup lang="ts">
import { useCssVar } from "@vueuse/core";
import type { HostMetricChartSeries } from "./chart-types";

const props = withDefaults(
  defineProps<{
    series: HostMetricChartSeries[];
    valueSuffix?: string;
    secondarySuffix?: string;
    maximum?: number;
  }>(),
  { valueSuffix: "", secondarySuffix: "", maximum: undefined },
);
const root = ref<HTMLElement | null>(null);
const primary = useCssVar("--primary", root);
const secondary = useCssVar("--primary-active", root);
const danger = useCssVar("--destructive", root);
const inkMuted = useCssVar("--ink-muted", root);
const hairline = useCssVar("--hairline", root);
const colors = computed(() => ({
  primary: primary.value,
  secondary: secondary.value,
  danger: danger.value,
}));

const option = computed<ECOption>(() => {
  const hasSecondaryAxis = props.series.some((item) => item.yAxisIndex === 1);
  return {
    animation: false,
    color: props.series.map((item) => colors.value[item.color]),
    grid: {
      left: "3%",
      right: hasSecondaryAxis ? "7%" : "3%",
      top: 28,
      bottom: 24,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => `${formatMetricValue(value)}${props.valueSuffix}`,
    },
    legend: { top: 0, textStyle: { color: inkMuted.value }, itemWidth: 12, itemHeight: 2 },
    xAxis: {
      type: "time",
      axisLabel: { color: inkMuted.value },
      axisLine: { lineStyle: { color: hairline.value } },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: "value",
        min: 0,
        max: props.maximum,
        axisLabel: { color: inkMuted.value, formatter: `{value}${props.valueSuffix}` },
        splitLine: { lineStyle: { color: hairline.value } },
      },
      ...(hasSecondaryAxis
        ? [
            {
              type: "value" as const,
              min: 0,
              axisLabel: { color: inkMuted.value, formatter: `{value}${props.secondarySuffix}` },
              splitLine: { show: false },
            },
          ]
        : []),
    ],
    series: props.series.map((item) => ({
      id: item.name,
      name: item.name,
      type: "line" as const,
      data: item.values,
      yAxisIndex: item.yAxisIndex ?? 0,
      showSymbol: false,
      smooth: 0.18,
      connectNulls: false,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" as const },
    })),
  };
});

function formatMetricValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}
</script>

<template>
  <div ref="root" class="h-52 min-h-0 w-full">
    <VChart class="size-full" :option="option" :autoresize="{ throttle: 100 }" />
  </div>
</template>
