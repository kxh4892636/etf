import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type {
  DailyBar,
  Security,
  ValuationMetric,
  ValuationPoint,
} from "../../../../shared/market.ts";
import type { SqliteDatabase } from "../../../libs/sqlite/database.ts";
import type { MarketRepository, TradingDay, ValuationRecord } from "../market-repository.ts";
import { supportedSecurities } from "../securities.ts";
import { dailyBars, securities, securityValuation, tradingCalendar } from "./schema.ts";

/** 加入顺序取证券目录顺序：老库的 rowid 是历史插入顺序，与目录顺序未必一致，不能用来排序。 */
const addedOrder = new Map(
  supportedSecurities.map(({ symbol }, index): [string, number] => [symbol, index]),
);
const orderOf = (symbol: string): number => addedOrder.get(symbol) ?? Number.MAX_SAFE_INTEGER;

const seed = (db: SqliteDatabase): void => {
  db.transaction((tx): void => {
    for (const definition of supportedSecurities)
      tx.insert(securities)
        .values(definition)
        .onConflictDoUpdate({ target: securities.symbol, set: definition })
        .run();
  });
};

export const createSqliteMarketRepository = (db: SqliteDatabase): MarketRepository => {
  seed(db);
  const latestDate = (symbol: string, adjType: string): string | undefined =>
    db
      .select({ date: dailyBars.tradeDate })
      .from(dailyBars)
      .where(and(eq(dailyBars.symbol, symbol), eq(dailyBars.adjType, adjType)))
      .orderBy(desc(dailyBars.tradeDate))
      .limit(1)
      .get()?.date;
  return {
    latestDate,
    listSecurities: (): Security[] =>
      db
        .select()
        .from(securities)
        .all()
        .map((security): Security => ({
          ...security,
          latestCachedTradeDate: latestDate(security.symbol, "qfq"),
        }))
        .sort((left, right): number => orderOf(left.symbol) - orderOf(right.symbol)),
    findSecurity: (symbol: string): Security | undefined =>
      db.select().from(securities).where(eq(securities.symbol, symbol)).get(),
    listBars: (symbol: string, adjType: string, start: string, end: string): DailyBar[] =>
      db
        .select()
        .from(dailyBars)
        .where(
          and(
            eq(dailyBars.symbol, symbol),
            eq(dailyBars.adjType, adjType),
            gte(dailyBars.tradeDate, start),
            lte(dailyBars.tradeDate, end),
          ),
        )
        .orderBy(dailyBars.tradeDate)
        .all(),
    tradingDays: (exchange: string, start: string, end: string): TradingDay[] =>
      db
        .select()
        .from(tradingCalendar)
        .where(
          and(
            eq(tradingCalendar.exchange, exchange),
            gte(tradingCalendar.tradeDate, start),
            lte(tradingCalendar.tradeDate, end),
          ),
        )
        .all(),
    latestValuationDate: (symbol: string): string | undefined =>
      db
        .select({ date: securityValuation.tradeDate })
        .from(securityValuation)
        .where(eq(securityValuation.symbol, symbol))
        .orderBy(desc(securityValuation.tradeDate))
        .limit(1)
        .get()?.date,
    listValuations: (
      symbol: string,
      metric: ValuationMetric,
      start: string,
      end: string,
    ): ValuationPoint[] =>
      db
        .select({
          dataDate: securityValuation.tradeDate,
          value: securityValuation.value,
          percentile: securityValuation.percentile,
        })
        .from(securityValuation)
        .where(
          and(
            eq(securityValuation.symbol, symbol),
            eq(securityValuation.metric, metric),
            gte(securityValuation.tradeDate, start),
            lte(securityValuation.tradeDate, end),
          ),
        )
        .orderBy(securityValuation.tradeDate)
        .all(),
    saveValuations: (records: ValuationRecord[]): void => {
      db.transaction((tx): void => {
        for (const record of records)
          tx.insert(securityValuation)
            .values(record)
            .onConflictDoUpdate({
              target: [
                securityValuation.symbol,
                securityValuation.metric,
                securityValuation.tradeDate,
              ],
              set: {
                value: record.value,
                percentile: record.percentile,
                updatedAt: sql`CURRENT_TIMESTAMP`,
              },
            })
            .run();
      });
    },
    saveRefresh: (bars: DailyBar[], days: TradingDay[]): void => {
      db.transaction((tx): void => {
        // 事务保证整批 upsert 一次提交，日线和日历不会部分写入。
        for (const bar of bars)
          tx.insert(dailyBars)
            .values(bar)
            .onConflictDoUpdate({
              target: [dailyBars.symbol, dailyBars.adjType, dailyBars.tradeDate],
              set: bar,
            })
            .run();
        for (const day of days)
          tx.insert(tradingCalendar)
            .values(day)
            .onConflictDoUpdate({
              target: [tradingCalendar.exchange, tradingCalendar.tradeDate],
              set: { isOpen: day.isOpen },
            })
            .run();
      });
    },
  };
};
