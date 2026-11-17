import {
  valuationMetrics,
  type ValuationMetric,
  type ValuationPoint,
  type ValuationSeries,
} from "@shared/market";

/** 估值曲线的独立范围：与 K 线周期互不影响。 */
export type ValuationRange = "1y" | "3y" | "5y" | "all";

export interface ValuationRangeOption {
  value: ValuationRange;
  label: string;
}

export const VALUATION_RANGE_OPTIONS: readonly ValuationRangeOption[] = [
  { value: "1y", label: "1年" },
  { value: "3y", label: "3年" },
  { value: "5y", label: "5年" },
  { value: "all", label: "全部" },
];

/** 指标单选，默认市盈率：四项里最常被拿来判断高低的那一项。 */
export const DEFAULT_VALUATION_METRIC: ValuationMetric = "pe";

const RANGE_YEARS: Record<Exclude<ValuationRange, "all">, number> = {
  "1y": 1,
  "3y": 3,
  "5y": 5,
};

/** 抽稀上限：约 300 点足以画满一屏，也不让 SVG 节点数失控。 */
export const MAX_CHART_POINTS = 300;

export const isValuationRange = (value: unknown): value is ValuationRange =>
  typeof value === "string" && VALUATION_RANGE_OPTIONS.some((option) => option.value === value);

export const isValuationMetric = (value: unknown): value is ValuationMetric =>
  typeof value === "string" && (valuationMetrics as readonly string[]).includes(value);

/** 旧记录没有该字段、或存的是旧版「可见指标集合」，都回退到默认指标。 */
export const parseValuationMetric = (
  value: unknown,
  fallback: ValuationMetric = DEFAULT_VALUATION_METRIC,
): ValuationMetric => (isValuationMetric(value) ? value : fallback);

const toUtcMs = (tradeDate: string): number => {
  const parts = tradeDate.split("-").map((part): number => Number.parseInt(part, 10));
  const [year, month, day] = parts;
  if (!year || !month || !day) return Number.NaN;
  return Date.UTC(year, month - 1, day);
};

const shiftYears = (ms: number, years: number): number => {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear() - years, date.getUTCMonth(), date.getUTCDate());
};

/** 全部指标里最新的数据日期，作为口径日期与范围锚点。 */
export const findLatestDataDate = (series: readonly ValuationSeries[]): string | null => {
  let latest: string | null = null;
  for (const item of series) {
    const candidate = item.latest?.dataDate ?? item.points.at(-1)?.dataDate ?? null;
    if (!candidate) continue;
    if (!latest || candidate > latest) latest = candidate;
  }
  return latest;
};

export const slicePointsByRange = (
  points: readonly ValuationPoint[],
  range: ValuationRange,
  anchorDate: string | null,
): ValuationPoint[] => {
  if (range === "all" || !anchorDate) return [...points];
  const anchorMs = toUtcMs(anchorDate);
  if (!Number.isFinite(anchorMs)) return [...points];
  const cutoff = shiftYears(anchorMs, RANGE_YEARS[range]);
  return points.filter((point): boolean => {
    const ms = toUtcMs(point.dataDate);
    return Number.isFinite(ms) && ms >= cutoff;
  });
};

export interface ValuationChartModel {
  metric: ValuationMetric;
  /** 与 percentiles / values 等长，按时间升序。 */
  dates: string[];
  /** 0–100 分位；null 表示当日上游缺分位，连线在此断开。 */
  percentiles: Array<number | null>;
  values: Array<number | null>;
}

interface BuildChartModelInput {
  series: readonly ValuationSeries[];
  metric: ValuationMetric;
  range: ValuationRange;
  maxPoints?: number;
}

/**
 * 把所选指标压到一条时间轴上：按范围切片、抽稀并保留最后一点。
 * 曲线按分位绘制，口径与上游一致（成立以来），不画指标原值。
 */
export const buildValuationChartModel = (input: BuildChartModelInput): ValuationChartModel => {
  const { series, metric, range } = input;
  const maxPoints = input.maxPoints ?? MAX_CHART_POINTS;
  const target = series.find((item): boolean => item.metric === metric);
  const points = target ? slicePointsByRange(target.points, range, findLatestDataDate(series)) : [];
  const step = Math.max(1, Math.ceil(points.length / Math.max(1, maxPoints)));
  const kept = points.filter(
    (_, index): boolean => index % step === 0 || index === points.length - 1,
  );

  return {
    metric,
    dates: kept.map((point): string => point.dataDate),
    percentiles: kept.map((point): number | null => point.percentile),
    values: kept.map((point): number => point.value),
  };
};

/** 连续有值的下标段，用来在不连续处断开折线。 */
export const splitLineSegments = (
  percentiles: readonly (number | null)[],
): number[][] => {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < percentiles.length; index += 1) {
    if (percentiles[index] == null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(index);
  }
  if (current.length > 0) segments.push(current);
  return segments;
};

/** 最后一个有值的下标，用于标出「最新」那个点。 */
export const lastDefinedIndex = (percentiles: readonly (number | null)[]): number | null => {
  for (let index = percentiles.length - 1; index >= 0; index -= 1) {
    if (percentiles[index] != null) return index;
  }
  return null;
};
