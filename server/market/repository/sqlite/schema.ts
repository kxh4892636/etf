import { sql } from "drizzle-orm";
import { sqliteTable, text, real, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { valuationMetrics } from "../../../../shared/market.ts";
export const securities = sqliteTable("securities", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  assetType: text("asset_type").notNull(),
  exchange: text("exchange").notNull(),
  currency: text("currency").notNull(),
  source: text("source").notNull(),
  earliestTradeDate: text("earliest_trade_date").notNull(),
});

export const dailyBars = sqliteTable(
  "daily_bars",
  {
    symbol: text("symbol").notNull(),
    adjType: text("adj_type").notNull(),
    tradeDate: text("trade_date").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
    amount: real("amount").notNull(),
    changeAmount: real("change_amount").notNull(),
    changePercent: real("change_percent").notNull(),
    rawWeekday: text("raw_weekday").notNull(),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.adjType, table.tradeDate] })],
);
export const tradingCalendar = sqliteTable(
  "trading_calendar",
  {
    exchange: text("exchange").notNull(),
    tradeDate: text("trade_date").notNull(),
    isOpen: integer("is_open").notNull(),
  },
  (table) => [primaryKey({ columns: [table.exchange, table.tradeDate] })],
);

/** 日频估值缓存：value 是统一比率，percentile 是历史分位，缺失存 NULL。 */
export const securityValuation = sqliteTable(
  "security_valuation",
  {
    symbol: text("symbol").notNull(),
    metric: text("metric", { enum: valuationMetrics }).notNull(),
    tradeDate: text("trade_date").notNull(),
    value: real("value").notNull(),
    percentile: real("percentile"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.metric, table.tradeDate] })],
);
