import type { ValuationMetric } from "@shared/market";
import { formatFixedNumber, formatNumber } from "@/utils/market-number-format";

export const METRIC_LABELS: Record<ValuationMetric, string> = {
  pe: "市盈率",
  pb: "市净率",
  ps: "市销率",
  dividendYield: "股息率",
};

/** 单位跟在数值后面，字号小一号；股息率上游存的是比率，展示时换回百分数。 */
export const METRIC_UNITS: Record<ValuationMetric, string> = {
  pe: "倍",
  pb: "倍",
  ps: "倍",
  dividendYield: "%",
};

export const formatMetricValue = (metric: ValuationMetric, value: number | null): string => {
  if (value == null || !Number.isFinite(value)) return "-";
  const shown = metric === "dividendYield" ? value * 100 : value;
  return formatFixedNumber(shown, 2);
};

/** 分位是 0–100 的百分数；读数取整，悬停提示保留两位，缺数据不补 0。 */
export const formatPercentile = (percentile: number | null, digits: number = 0): string => {
  if (percentile == null || !Number.isFinite(percentile)) return "-";
  return `${digits === 0 ? formatNumber(percentile, 0) : formatFixedNumber(percentile, digits)}%`;
};

/** 坐标轴只标年月，一屏三处标签也不会挤在一起。 */
export const formatMonth = (tradeDate: string): string => tradeDate.slice(0, 7);
