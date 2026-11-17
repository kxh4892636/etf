import { expect, it, vi } from "vite-plus/test";
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
import { MarketError } from "./errors.ts";
import {
  createValuationService,
  expectedValuationDate,
  type RemoteValuationFetcher,
} from "./valuation-service.ts";

const security: Security = {
  symbol: "930955.CSI",
  name: "红利低波100",
  assetType: "index",
  exchange: "CSI",
  currency: "CNY",
  source: "hongsehuojian",
  earliestTradeDate: "2005-12-30",
};

const point = (date: string, value: number, percentile: number | null = null): ValuationPoint => ({
  dataDate: date,
  value,
  percentile,
});

/** 内存仓储替身：证明估值用例不依赖 SQLite。 */
const createFakeRepository = (seed: ValuationRecord[] = []) => {
  const rows = new Map<string, ValuationRecord>();
  const key = (record: ValuationRecord): string =>
    [record.symbol, record.metric, record.tradeDate].join("|");
  for (const record of seed) rows.set(key(record), record);
  const repository: MarketRepository = {
    listSecurities: (): Security[] => [security],
    findSecurity: (symbol: string): Security | undefined =>
      symbol === security.symbol ? security : undefined,
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

const now = (): Date => new Date("2026-11-16T01:00:00Z");

const createFetch = (points: (metric: ValuationMetric) => ValuationPoint[]) =>
  vi.fn<RemoteValuationFetcher>(
    async (_symbol: string, metric: ValuationMetric): Promise<ValuationPoint[]> => points(metric),
  );

const series = (metric: ValuationMetric, fetched: ValuationPoint[]): ValuationRecord[] =>
  fetched.map(
    (item): ValuationRecord => ({
      symbol: security.symbol,
      metric,
      tradeDate: item.dataDate,
      value: item.value,
      percentile: item.percentile,
    }),
  );

it("应有最新交易日跳过周末", (): void => {
  expect(expectedValuationDate(new Date("2026-11-16T01:00:00Z"))).toBe("2026-11-13");
  expect(expectedValuationDate(new Date("2026-11-18T01:00:00Z"))).toBe("2026-11-17");
});

it("缓存已到应有交易日时只读缓存", async (): Promise<void> => {
  const cached = [
    ...series("pe", [point("2026-11-12", 17.1, 10), point("2026-11-13", 17.5, 12)]),
    ...series("pb", [point("2026-11-13", 1.2, 30)]),
  ];
  const { repository } = createFakeRepository(cached);
  const fetcher = createFetch((): ValuationPoint[] => []);
  const service = createValuationService({ repository, fetcher, now });
  const data = await service.getValuations({ symbol: security.symbol });
  expect(fetcher).not.toHaveBeenCalled();
  expect(data.symbol).toBe(security.symbol);
  expect(data.series.map((item): ValuationMetric => item.metric)).toEqual([
    "pe",
    "pb",
    "ps",
    "dividendYield",
  ]);
  expect(data.series[0]).toEqual({
    metric: "pe",
    points: [point("2026-11-12", 17.1, 10), point("2026-11-13", 17.5, 12)],
    latest: point("2026-11-13", 17.5, 12),
  });
  expect(data.series[2]).toEqual({ metric: "ps", points: [], latest: null });
});

it("缓存缺失时拉四个指标、裁剪当日数据并升序返回", async (): Promise<void> => {
  const fetcher = createFetch((metric: ValuationMetric): ValuationPoint[] => [
    point("2026-11-13", metric === "dividendYield" ? 0.0446 : 2, 40),
    point("2026-11-16", 99, 0),
  ]);
  const { repository, rows } = createFakeRepository();
  const service = createValuationService({ repository, fetcher, now });
  const data = await service.getValuations({ symbol: security.symbol });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.map((call): ValuationMetric => call[1])).toEqual([
    "pe",
    "pb",
    "ps",
    "dividendYield",
  ]);
  // 当日数据未完成，不写入。
  expect(rows.size).toBe(4);
  expect(data.series.every((item): boolean => item.points.length === 1)).toBe(true);
  expect(data.series[0]?.latest).toEqual(point("2026-11-13", 2, 40));
  expect(data.series[3]?.latest?.value).toBe(0.0446);
});

it("缓存落后于应有交易日时重新拉取并补齐", async (): Promise<void> => {
  const { repository } = createFakeRepository(series("pe", [point("2026-11-12", 1, 1)]));
  const fetcher = createFetch((): ValuationPoint[] => [point("2026-11-13", 3, 3)]);
  const service = createValuationService({ repository, fetcher, now });
  const data = await service.getValuations({ symbol: security.symbol });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(data.series[0]?.points).toEqual([point("2026-11-12", 1, 1), point("2026-11-13", 3, 3)]);
  expect(data.series[0]?.latest).toEqual(point("2026-11-13", 3, 3));
});

it("补拉后仍落后于应有交易日时冷却 10 分钟，不重复下载全量", async (): Promise<void> => {
  // 节假日与上游延迟发布时缓存永远到不了应有交易日：只冷却，不报错也不反复拉。
  let clock = new Date("2026-11-16T01:00:00Z").getTime();
  const { repository } = createFakeRepository(series("pe", [point("2026-11-12", 1, 1)]));
  const fetcher = createFetch((): ValuationPoint[] => [point("2026-11-12", 1, 1)]);
  const service = createValuationService({
    repository,
    fetcher,
    now: (): Date => new Date(clock),
  });
  const first = await service.getValuations({ symbol: security.symbol });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(first.series[0]?.latest).toEqual(point("2026-11-12", 1, 1));
  await service.getValuations({ symbol: security.symbol });
  expect(fetcher).toHaveBeenCalledTimes(4);
  clock += 10 * 60_000;
  await service.getValuations({ symbol: security.symbol });
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it("上游失败但有缓存时返回缓存", async (): Promise<void> => {
  const { repository } = createFakeRepository(series("pe", [point("2026-11-01", 2, 2)]));
  const fetcher = vi.fn<RemoteValuationFetcher>(async (): Promise<ValuationPoint[]> => {
    throw new MarketError("upstream_unavailable", "上游估值不可用");
  });
  const service = createValuationService({ repository, fetcher, now });
  const data = await service.getValuations({ symbol: security.symbol });
  expect(data.series[0]?.latest).toEqual(point("2026-11-01", 2, 2));
});

it("上游失败且无缓存时抛上游错误", async (): Promise<void> => {
  const { repository } = createFakeRepository();
  const fetcher = vi.fn<RemoteValuationFetcher>(async (): Promise<ValuationPoint[]> => {
    throw new MarketError("deadline_exceeded", "上游请求超时");
  });
  const service = createValuationService({ repository, fetcher, now });
  await expect(service.getValuations({ symbol: security.symbol })).rejects.toMatchObject({
    code: "deadline_exceeded",
  });
});

it("上游无数据时不写库并抛未找到", async (): Promise<void> => {
  const { repository, rows } = createFakeRepository();
  const service = createValuationService({ repository, fetcher: createFetch(() => []), now });
  await expect(service.getValuations({ symbol: security.symbol })).rejects.toMatchObject({
    code: "not_found",
  });
  expect(rows.size).toBe(0);
});

it("未知证券直接抛出未找到", async (): Promise<void> => {
  const { repository } = createFakeRepository();
  const fetcher = createFetch(() => []);
  const service = createValuationService({ repository, fetcher, now });
  await expect(service.getValuations({ symbol: "000001.SH" })).rejects.toMatchObject({
    code: "not_found",
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("取消发生在上游返回时既不写库也不返回缓存", async (): Promise<void> => {
  const controller = new AbortController();
  const { repository, rows } = createFakeRepository();
  const fetcher = vi.fn<RemoteValuationFetcher>(
    async (_symbol: string, metric: ValuationMetric): Promise<ValuationPoint[]> => {
      if (metric === "pb") controller.abort();
      return [point("2026-11-13", 1, 1)];
    },
  );
  const service = createValuationService({ repository, fetcher, now });
  await expect(
    service.getValuations({ symbol: security.symbol }, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(rows.size).toBe(0);
});
