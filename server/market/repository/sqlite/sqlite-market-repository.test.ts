import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { sql } from "drizzle-orm";
import type { DailyBar, ValuationMetric } from "../../../../shared/market.ts";
import type { ValuationRecord } from "../market-repository.ts";
import { openSqliteDatabase } from "../../../libs/sqlite/database.ts";
import { createSqliteMarketRepository } from "./sqlite-market-repository.ts";

const folders: string[] = [];
const databases: ReturnType<typeof openSqliteDatabase>[] = [];
const temp = (): string => {
  const value = mkdtempSync(path.join(os.tmpdir(), "etf-test-"));
  folders.push(value);
  return value;
};
const open = (file = ":memory:"): ReturnType<typeof openSqliteDatabase> => {
  const db = openSqliteDatabase(file);
  databases.push(db);
  return db;
};
const bar = (date: string, close = 101): DailyBar => ({
  symbol: "932315.CSI",
  adjType: "qfq",
  tradeDate: date,
  open: 100,
  high: 103,
  low: 99,
  close,
  volume: 10,
  amount: 1000,
  changeAmount: 1,
  changePercent: 1,
  rawWeekday: "五",
});
afterEach((): void => {
  for (const db of databases.splice(0)) db.$client.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("SQLite 仓储", (): void => {
  it("迁移幂等、重启保留证券并按加入顺序列出", (): void => {
    const file = path.join(temp(), "nested", "db.sqlite");
    for (let index = 0; index < 2; index++) {
      const db = openSqliteDatabase(file);
      try {
        const listed = createSqliteMarketRepository(db).listSecurities();
        expect(listed.map((security): string => security.symbol)).toEqual([
          "930955.CSI",
          "932315.CSI",
          "932422.CSI",
          "399989.SZ",
          "931643.CSI",
        ]);
        expect(listed[0]).toEqual({
          symbol: "930955.CSI",
          name: "红利低波100",
          assetType: "index",
          exchange: "CSI",
          currency: "CNY",
          source: "hongsehuojian",
          earliestTradeDate: "2005-12-30",
        });
        expect(listed[4]).toMatchObject({ symbol: "931643.CSI", exchange: "CSI" });
        expect(listed[3]).toMatchObject({ symbol: "399989.SZ", exchange: "SZ" });
      } finally {
        db.$client.close();
      }
    }
  });
  it("事务回滚后证券仍在", (): void => {
    const db = open();
    const repository = createSqliteMarketRepository(db);
    expect(() =>
      db.transaction((tx): void => {
        tx.run(sql`DELETE FROM securities`);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(repository.listSecurities()).toHaveLength(5);
  });
  it("数据库损坏时拒绝启动并释放句柄", (): void => {
    const file = path.join(temp(), "broken.sqlite");
    writeFileSync(file, "not sqlite");
    expect(() => openSqliteDatabase(file)).toThrow();
  });
  it("upsert 幂等、按日期返回并记录交易日历", (): void => {
    const repository = createSqliteMarketRepository(open());
    repository.saveRefresh([bar("2026-05-27")], []);
    repository.saveRefresh([{ ...bar("2026-05-29"), close: 102 }], []);
    expect(
      repository
        .listBars("932315.CSI", "qfq", "2026-05-27", "2026-05-30")
        .map((value): number => value.close),
    ).toEqual([101, 102]);
    repository.saveRefresh([], [{ exchange: "CSI", tradeDate: "2026-05-28", isOpen: 0 }]);
    expect(repository.tradingDays("CSI", "2026-05-28", "2026-05-28")).toEqual([
      { exchange: "CSI", tradeDate: "2026-05-28", isOpen: 0 },
    ]);
    expect(repository.latestDate("932315.CSI", "qfq")).toBe("2026-05-29");
  });
  it("估值 upsert 幂等、按区间升序返回并保留空分位", (): void => {
    const db = open();
    const repository = createSqliteMarketRepository(db);
    const record = (
      metric: ValuationMetric,
      tradeDate: string,
      value: number,
      percentile: number | null,
    ): ValuationRecord => ({ symbol: "930955.CSI", metric, tradeDate, value, percentile });
    repository.saveValuations([
      record("pe", "2026-11-13", 17.5, 12),
      record("pe", "2026-11-12", 17.1, null),
    ]);
    repository.saveValuations([
      record("pe", "2026-11-13", 17.6, 13),
      record("dividendYield", "2026-11-13", 0.0446, 88),
    ]);
    expect(repository.listValuations("930955.CSI", "pe", "2026-11-01", "2026-11-30")).toEqual([
      { dataDate: "2026-11-12", value: 17.1, percentile: null },
      { dataDate: "2026-11-13", value: 17.6, percentile: 13 },
    ]);
    expect(repository.listValuations("930955.CSI", "pe", "2026-11-13", "2026-11-30")).toHaveLength(
      1,
    );
    expect(repository.listValuations("930955.CSI", "pb", "2026-11-01", "2026-11-30")).toEqual([]);
    expect(
      repository.listValuations("930955.CSI", "dividendYield", "2026-11-01", "2026-11-30"),
    ).toEqual([{ dataDate: "2026-11-13", value: 0.0446, percentile: 88 }]);
    expect(repository.latestValuationDate("930955.CSI")).toBe("2026-11-13");
    expect(repository.latestValuationDate("932315.CSI")).toBeUndefined();
    const row = db.get<{ updated_at: string }>(sql`select updated_at from security_valuation limit 1`);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
  it("写交易日历失败会连同日线回滚", (): void => {
    const db = open();
    const repository = createSqliteMarketRepository(db);
    db.run(
      sql.raw(
        "CREATE TRIGGER reject_calendar BEFORE INSERT ON trading_calendar BEGIN SELECT RAISE(ABORT,'reject'); END;",
      ),
    );
    expect(() =>
      repository.saveRefresh(
        [bar("2026-05-29")],
        [{ exchange: "CSI", tradeDate: "2026-05-29", isOpen: 1 }],
      ),
    ).toThrow();
    expect(repository.latestDate("932315.CSI", "qfq")).toBeUndefined();
  });
});
