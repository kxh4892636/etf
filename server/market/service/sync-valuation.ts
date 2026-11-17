import {
  valuationMetrics,
  type Security,
  type ValuationMetric,
} from "../../../shared/market.ts";
import type { MarketRepository } from "../repository/market-repository.ts";
import { MarketError } from "./errors.ts";
import {
  expectedValuationDate,
  refreshValuations,
  type RemoteValuationFetcher,
  type ValuationServiceDependencies,
} from "./valuation-service.ts";

export interface ValuationSyncMetricSummary {
  metric: ValuationMetric;
  rows: number;
  earliestDataDate?: string | undefined;
  latestDataDate?: string | undefined;
}

export interface ValuationSyncSummary {
  symbol: string;
  name: string;
  /** 上游无数据时说明原因，此时不写库。 */
  skipped?: string | undefined;
  metrics: ValuationSyncMetricSummary[];
}

export interface ValuationSyncDependencies
  extends Pick<ValuationServiceDependencies, "repository" | "now"> {
  fetcher: RemoteValuationFetcher;
}

export interface ValuationSyncOptions {
  symbols?: string[];
}

/**
 * 估值回填 workflow：逐只证券拉四个指标并整批 upsert，
 * 返回每条证券每个指标的入库行数与日期范围；上游无数据的证券跳过并说明。
 */
export const syncValuationData = async (
  deps: ValuationSyncDependencies,
  options: ValuationSyncOptions = {},
): Promise<ValuationSyncSummary[]> => {
  const repository: MarketRepository = deps.repository;
  const completed = expectedValuationDate((deps.now ?? ((): Date => new Date()))());
  const securities: Security[] = options.symbols
    ? options.symbols.map((symbol: string): Security => {
        const security = repository.findSecurity(symbol);
        if (!security) throw new MarketError("not_found", "证券不存在: " + symbol);
        return security;
      })
    : repository.listSecurities();
  const summaries: ValuationSyncSummary[] = [];
  for (const security of securities) {
    const written = await refreshValuations(deps, security, completed);
    if (written === 0) {
      summaries.push({
        symbol: security.symbol,
        name: security.name,
        skipped: "上游没有估值数据（ETF 走 index 通道返回空对象，本次不接入）",
        metrics: [],
      });
      continue;
    }
    summaries.push({
      symbol: security.symbol,
      name: security.name,
      metrics: valuationMetrics.map((metric: ValuationMetric): ValuationSyncMetricSummary => {
        const points = repository.listValuations(
          security.symbol,
          metric,
          security.earliestTradeDate,
          completed,
        );
        return {
          metric,
          rows: points.length,
          earliestDataDate: points[0]?.dataDate,
          latestDataDate: points.at(-1)?.dataDate,
        };
      }),
    });
  }
  return summaries;
};
