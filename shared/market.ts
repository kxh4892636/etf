export interface Security {
  symbol: string;
  name: string;
  assetType: string;
  exchange: string;
  currency: string;
  source: string;
  earliestTradeDate: string;
  latestCachedTradeDate?: string | undefined;
}

export interface DailyBar {
  symbol: string;
  adjType: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  changeAmount: number;
  changePercent: number;
  rawWeekday: string;
}

export interface DailyBarsMeta {
  cacheStatus: "invalid" | "cache" | "refreshed";
  requestedStartDate: string;
  requestedEndDate: string;
  effectiveStartDate?: string | undefined;
  effectiveEndDate?: string | undefined;
  earliestTradeDate: string;
  latestCachedTradeDate?: string | undefined;
  refreshed: boolean;
  rows: number;
}

export interface DailyBarsResponse {
  security: Security;
  bars: DailyBar[];
  meta: DailyBarsMeta;
}

/** 估值指标：市盈率、市净率、市销率、股息率。 */
export const valuationMetrics = ["pe", "pb", "ps", "dividendYield"] as const;

export type ValuationMetric = (typeof valuationMetrics)[number];

/**
 * 单个交易日的估值观测。
 * value 是统一比率：PE/PB/PS 为倍数，股息率由上游百分数除以 100（0.0447 即 4.47%）。
 * percentile 是 0–100 的历史分位，上游缺失时为 null，不用 0 冒充。
 */
export interface ValuationPoint {
  dataDate: string;
  value: number;
  percentile: number | null;
}

/** 单指标序列：points 按日期升序；无数据时 points 为空数组、latest 为 null。 */
export interface ValuationSeries {
  metric: ValuationMetric;
  points: ValuationPoint[];
  latest: ValuationPoint | null;
}

/**
 * 四指标估值。series 恒含 pe/pb/ps/dividendYield 四项且顺序固定，
 * 缺失指标用空序列表达（缺数据选空数组，不选 null）。
 */
export interface ValuationsResponse {
  symbol: string;
  series: ValuationSeries[];
}
