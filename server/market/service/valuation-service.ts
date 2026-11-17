import {
  valuationMetrics,
  type Security,
  type ValuationMetric,
  type ValuationPoint,
  type ValuationSeries,
  type ValuationsResponse,
} from "../../../shared/market.ts";
import { addDays, isWeekday } from "../../../shared/utils/trade-date.ts";
import { shanghaiDate } from "../../utils/dates.ts";
import type { MarketRepository, ValuationRecord } from "../repository/market-repository.ts";
import { MarketError } from "./errors.ts";

/** 上游估值取数：一次一个指标，返回日期升序的点。 */
export type RemoteValuationFetcher = (
  symbol: string,
  metric: ValuationMetric,
  signal?: AbortSignal,
) => Promise<ValuationPoint[]>;

export interface ValuationsInput {
  symbol: string;
}

export interface ValuationService {
  getValuations: (input: ValuationsInput, signal?: AbortSignal) => Promise<ValuationsResponse>;
}

export interface ValuationServiceDependencies {
  repository: MarketRepository;
  fetcher: RemoteValuationFetcher;
  now?: () => Date;
}

/**
 * 应有数据的最新交易日：上海昨日起回看最近的工作日。
 * 估值按工作日发布，节假日差异由下次请求再次比对兜底。
 */
export const expectedValuationDate = (now: Date): string => {
  const completed = addDays(shanghaiDate(now), -1);
  for (let offset = 0; offset < 7; offset++) {
    const candidate = addDays(completed, -offset);
    if (isWeekday(candidate)) return candidate;
  }
  return completed;
};

/** 拉四个指标并整体 upsert，返回写入行数；0 表示上游对这只证券没有估值数据。 */
export const refreshValuations = async (
  deps: ValuationServiceDependencies,
  security: Security,
  completed: string,
  signal?: AbortSignal,
): Promise<number> => {
  const remote = await Promise.all(
    valuationMetrics.map((metric: ValuationMetric): Promise<ValuationPoint[]> =>
      deps.fetcher(security.symbol, metric, signal),
    ),
  );
  signal?.throwIfAborted();
  const records = valuationMetrics.flatMap(
    (metric: ValuationMetric, index: number): ValuationRecord[] =>
      (remote[index] ?? [])
        // 当日数据未收盘不完整，与日线一样裁剪到昨日。
        .filter((point: ValuationPoint): boolean => point.dataDate <= completed)
        .map(
          (point: ValuationPoint): ValuationRecord => ({
            symbol: security.symbol,
            metric,
            tradeDate: point.dataDate,
            value: point.value,
            percentile: point.percentile,
          }),
        ),
  );
  if (records.length) deps.repository.saveValuations(records);
  return records.length;
};

/**
 * 补拉冷却：估值日更，节假日与上游延迟发布时会「缓存永远到不了应有交易日」。
 * 同一证券 10 分钟内只补拉一次，避免每次请求（含窗口重新聚焦）都重下四份全历史。
 */
const REFRESH_COOLDOWN_MS = 10 * 60_000;

export const createValuationService = (
  deps: ValuationServiceDependencies,
): ValuationService => {
  const now = deps.now ?? ((): Date => new Date());
  const refreshedAt = new Map<string, number>();
  const readSeries = (security: Security, completed: string): ValuationSeries[] =>
    valuationMetrics.map((metric: ValuationMetric): ValuationSeries => {
      const points = deps.repository.listValuations(
        security.symbol,
        metric,
        security.earliestTradeDate,
        completed,
      );
      return { metric, points, latest: points.at(-1) ?? null };
    });
  return {
    getValuations: async (
      input: ValuationsInput,
      signal?: AbortSignal,
    ): Promise<ValuationsResponse> => {
      const security = deps.repository.findSecurity(input.symbol);
      if (!security) throw new MarketError("not_found", "证券不存在");
      const completed = expectedValuationDate(now());
      const cachedDate = deps.repository.latestValuationDate(security.symbol);
      const lastRefresh = refreshedAt.get(security.symbol);
      const cooling =
        lastRefresh !== undefined && now().getTime() - lastRefresh < REFRESH_COOLDOWN_MS;
      if ((cachedDate === undefined || cachedDate < completed) && !cooling) {
        try {
          await refreshValuations(deps, security, completed, signal);
          signal?.throwIfAborted();
          refreshedAt.set(security.symbol, now().getTime());
        } catch (error) {
          // 上游失败时退回已有缓存，没有缓存才把错误交给上层映射。
          if (signal?.aborted) throw signal.reason;
          if (cachedDate === undefined) throw error;
        }
      }
      const series = readSeries(security, completed);
      if (!series.some((item: ValuationSeries): boolean => item.latest !== null))
        throw new MarketError("not_found", "证券没有估值数据");
      return { symbol: security.symbol, series };
    },
  };
};
