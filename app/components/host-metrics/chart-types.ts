export interface HostMetricChartSeries {
  name: string;
  color: "primary" | "secondary" | "danger";
  values: Array<[string, number | null]>;
  yAxisIndex?: number;
}
