import type {
  DailyBar,
  Security,
  ValuationMetric,
  ValuationPoint,
} from "../../../shared/market.ts";

export interface TradingDay {
  exchange: string;
  tradeDate: string;
  isOpen: number;
}

/** 待写入的估值行；value 是统一比率（股息率已除以 100），分位缺失为 null。 */
export interface ValuationRecord {
  symbol: string;
  metric: ValuationMetric;
  tradeDate: string;
  value: number;
  percentile: number | null;
}

/** 数据库访问接口；SQLite/MySQL/PostgreSQL 实现均需满足此契约。 */
export interface MarketRepository {
  listSecurities: () => Security[];
  findSecurity: (symbol: string) => Security | undefined;
  latestDate: (symbol: string, adjType: string) => string | undefined;
  listBars: (symbol: string, adjType: string, start: string, end: string) => DailyBar[];
  tradingDays: (exchange: string, start: string, end: string) => TradingDay[];
  saveRefresh: (bars: DailyBar[], days: TradingDay[]) => void;
  /** 整批 upsert 估值行，一次事务提交。 */
  saveValuations: (records: ValuationRecord[]) => void;
  /** 证券四个指标里最新的数据日期，用于判断缓存是否过期。 */
  latestValuationDate: (symbol: string) => string | undefined;
  /** 按区间取单指标序列，日期升序。 */
  listValuations: (
    symbol: string,
    metric: ValuationMetric,
    start: string,
    end: string,
  ) => ValuationPoint[];
}
