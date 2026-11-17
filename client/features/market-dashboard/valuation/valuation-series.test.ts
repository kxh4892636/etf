import { expect, test } from "vite-plus/test";
import type { ValuationPoint, ValuationSeries } from "@shared/market";
import {
  buildValuationChartModel,
  DEFAULT_VALUATION_METRIC,
  findLatestDataDate,
  lastDefinedIndex,
  parseValuationMetric,
  slicePointsByRange,
  splitLineSegments,
  VALUATION_RANGE_OPTIONS,
} from "./valuation-series";

const points = (dates: string[], percentiles?: Array<number | null>): ValuationPoint[] =>
  dates.map((dataDate, index) => ({
    dataDate,
    value: 10 + index,
    percentile: percentiles ? (percentiles[index] ?? null) : index * 10,
  }));

const series = (metric: ValuationSeries["metric"], rows: ValuationPoint[]): ValuationSeries => ({
  metric,
  points: rows,
  latest: rows.at(-1) ?? null,
});

test("单选指标解析：缺字段、旧版集合、非法值都回退默认", (): void => {
  expect(DEFAULT_VALUATION_METRIC).toBe("pe");
  expect(parseValuationMetric(undefined)).toBe("pe");
  expect(parseValuationMetric("pb")).toBe("pb");
  expect(parseValuationMetric("dividendYield")).toBe("dividendYield");
  // 旧记录存的是可见指标集合，不是单值，按缺字段处理。
  expect(parseValuationMetric(["pe", "pb"])).toBe("pe");
  expect(parseValuationMetric("bad")).toBe("pe");
  expect(parseValuationMetric(7)).toBe("pe");
  expect(parseValuationMetric(null, "ps")).toBe("ps");
});

test("最新数据日期取四项里最大的一天", (): void => {
  const input = [
    series("pe", points(["2024-01-02", "2024-01-05"])),
    series("pb", points(["2024-01-03", "2024-02-01"])),
  ];
  expect(findLatestDataDate(input)).toBe("2024-02-01");
  expect(findLatestDataDate([])).toBeNull();
  expect(findLatestDataDate([series("pe", [])])).toBeNull();
});

test("范围按最新数据日回退到整年，全部范围原样返回", (): void => {
  const rows = points(["2018-01-31", "2021-06-30", "2023-11-30", "2024-11-30"]);
  expect(slicePointsByRange(rows, "all", "2024-11-30")).toHaveLength(4);
  // 正好一整年前的观测仍在窗口内（闭区间）。
  expect(slicePointsByRange(rows, "1y", "2024-11-30").map((row) => row.dataDate)).toEqual([
    "2023-11-30",
    "2024-11-30",
  ]);
  expect(slicePointsByRange(rows, "5y", "2024-11-30").map((row) => row.dataDate)).toEqual([
    "2021-06-30",
    "2023-11-30",
    "2024-11-30",
  ]);
  expect(slicePointsByRange(rows, "1y", null)).toHaveLength(4);
});

test("曲线模型只取所选指标，抽稀后保留最后一天", (): void => {
  const dates = Array.from({ length: 8 }, (_, index): string => `2024-01-0${index + 1}`);
  const model = buildValuationChartModel({
    series: [series("pe", points(dates)), series("pb", points(dates.slice(0, 5)))],
    metric: "pe",
    range: "all",
    maxPoints: 4,
  });
  // 8 个日期按步长 2 抽稀，并强制保留最后一天。
  expect(model.metric).toBe("pe");
  expect(model.dates).toEqual([
    "2024-01-01",
    "2024-01-03",
    "2024-01-05",
    "2024-01-07",
    "2024-01-08",
  ]);
  expect(model.percentiles).toEqual([0, 20, 40, 60, 70]);
  expect(model.values).toEqual([10, 12, 14, 16, 17]);
});

test("缺失分位保留为 null，连线据此断开", (): void => {
  const model = buildValuationChartModel({
    series: [series("ps", points(["2024-01-02", "2024-01-03"], [null, 42]))],
    metric: "ps",
    range: "all",
  });
  expect(model.percentiles).toEqual([null, 42]);
  expect(model.values).toEqual([10, 11]);
});

test("范围收窄后只保留窗口内的观测", (): void => {
  const model = buildValuationChartModel({
    series: [series("pe", points(["2020-01-31", "2024-06-28", "2024-11-29"]))],
    metric: "pe",
    range: "1y",
  });
  expect(model.dates).toEqual(["2024-06-28", "2024-11-29"]);
  expect(model.percentiles).toEqual([10, 20]);
});

test("所选指标没有序列时不给日期轴", (): void => {
  const model = buildValuationChartModel({
    series: [series("pe", points(["2024-01-02"]))],
    metric: "dividendYield",
    range: "all",
  });
  expect(model.dates).toEqual([]);
  expect(model.percentiles).toEqual([]);
});

test("断线分段与最后一个有效点", (): void => {
  expect(splitLineSegments([null, 1, 2, null, null, 3])).toEqual([[1, 2], [5]]);
  expect(splitLineSegments([null, null])).toEqual([]);
  expect(lastDefinedIndex([1, null, 3, null])).toBe(2);
  expect(lastDefinedIndex([null])).toBeNull();
});

test("范围选项覆盖 1 年、3 年、5 年与全部", (): void => {
  expect(VALUATION_RANGE_OPTIONS.map((option) => option.value)).toEqual(["1y", "3y", "5y", "all"]);
});
