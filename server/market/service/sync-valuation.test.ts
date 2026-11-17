import { expect, test, vi } from "vite-plus/test";
import type {
  DailyBar,
  Security,
  ValuationMetric,
  ValuationPoint,
} from "../../../shared/market.ts";
import type {
  MarketRepository,
  TradingDay,
  ValuationRecord,
} from "../repository/market-repository.ts";
import { syncValuationData } from "./sync-valuation.ts";
import type { RemoteValuationFetcher } from "./valuation-service.ts";

const securities: Security[] = [
  {
    symbol: "932315.CSI",
    name: "中证红利质量",
    assetType: "index",
    exchange: "CSI",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2013-12-31",
  },
  {
    symbol: "515070.SH",
    name: "人工智能ETF",
    assetType: "etf",
    exchange: "SH",
    currency: "CNY",
    source: "hongsehuojian",
    earliestTradeDate: "2019-01-01",
  },
];

const createRepository = () => {
  const seeded = new Map(securities.map((item): [string, Security] => [item.symbol, item]));
  const rows = new Map<string, ValuationRecord>();
  const key = (record: ValuationRecord): string =>
    [record.symbol, record.metric, record.tradeDate].join("|");
  const repository: MarketRepository = {
    listSecurities: (): Security[] => [...seeded.values()],
    findSecurity: (symbol: string): Security | undefined => seeded.get(symbol),
    latestDate: (): string | undefined => undefined,
    listBars: (): DailyBar[] => [],
    tradingDays: (): TradingDay[] => [],
    saveRefresh: (): void => {},
    saveValuations: (records: ValuationRecord[]): void => {
      for (const record of records) rows.set(key(record), record);
    },
    latestValuationDate: (symbol: string): string | undefined =>
      [...rows.values()]
        .filter((record): boolean => record.symbol === symbol)
        .map((record): string => record.tradeDate)
        .sort()
        .at(-1),
    listValuations: (
      symbol: string,
      metric: ValuationMetric,
      start: string,
      end: string,
    ): ValuationPoint[] =>
      [...rows.values()]
        .filter(
          (record): boolean =>
            record.symbol === symbol &&
            record.metric === metric &&
            record.tradeDate >= start &&
            record.tradeDate <= end,
        )
        .map(
          (record): ValuationPoint => ({
            dataDate: record.tradeDate,
            value: record.value,
            percentile: record.percentile,
          }),
        )
        .sort((left: ValuationPoint, right: ValuationPoint): number =>
          left.dataDate.localeCompare(right.dataDate),
        ),
  };
  return { repository, rows };
};

test("回填写入四个指标并输出行数与日期范围，无数据的证券跳过", async (): Promise<void> => {
  const { repository, rows } = createRepository();
  const fetcher = vi.fn<RemoteValuationFetcher>(
    async (symbol: string, metric: ValuationMetric): Promise<ValuationPoint[]> =>
      symbol === "515070.SH"
        ? []
        : [
            { dataDate: "2026-11-12", value: metric === "dividendYield" ? 0.04 : 1, percentile: 5 },
            { dataDate: "2026-11-13", value: metric === "dividendYield" ? 0.05 : 2, percentile: 6 },
          ],
  );
  const summary = await syncValuationData({
    repository,
    fetcher,
    now: (): Date => new Date("2026-11-16T01:00:00Z"),
  });
  expect(summary).toEqual([
    {
      symbol: "932315.CSI",
      name: "中证红利质量",
      metrics: [
        { metric: "pe", rows: 2, earliestDataDate: "2026-11-12", latestDataDate: "2026-11-13" },
        { metric: "pb", rows: 2, earliestDataDate: "2026-11-12", latestDataDate: "2026-11-13" },
        { metric: "ps", rows: 2, earliestDataDate: "2026-11-12", latestDataDate: "2026-11-13" },
        {
          metric: "dividendYield",
          rows: 2,
          earliestDataDate: "2026-11-12",
          latestDataDate: "2026-11-13",
        },
      ],
    },
    {
      symbol: "515070.SH",
      name: "人工智能ETF",
      skipped: "上游没有估值数据（ETF 走 index 通道返回空对象，本次不接入）",
      metrics: [],
    },
  ]);
  expect(rows.size).toBe(8);
});

test("重复回填不新增重复行", async (): Promise<void> => {
  const { repository, rows } = createRepository();
  const fetcher = vi.fn<RemoteValuationFetcher>(
    async (): Promise<ValuationPoint[]> => [{ dataDate: "2026-11-13", value: 1, percentile: 1 }],
  );
  const now = (): Date => new Date("2026-11-16T01:00:00Z");
  await syncValuationData({ repository, fetcher, now }, { symbols: ["932315.CSI"] });
  await syncValuationData({ repository, fetcher, now }, { symbols: ["932315.CSI"] });
  expect(rows.size).toBe(4);
});

test("未知证券返回稳定错误", async (): Promise<void> => {
  const { repository } = createRepository();
  await expect(
    syncValuationData(
      { repository, fetcher: vi.fn<RemoteValuationFetcher>(async (): Promise<ValuationPoint[]> => []) },
      { symbols: ["no"] },
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});
