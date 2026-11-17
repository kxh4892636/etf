import { expect, it, vi } from "vite-plus/test";
import { valuationMetrics } from "../../../shared/market.ts";
import { createValuationFetcher, parseValuation } from "./valuation.ts";

const payload = {
  data: {
    valuation: 17.5,
    percentile: 12.34,
    items: [
      { tradeDate: "20261113", valuationValue: 17.5, historicalPercentile: 12.34 },
      { tradeDate: "20261112", valuationValue: 17.1, historicalPercentile: 11.9 },
    ],
  },
};

it("按日期升序解析并转成 ISO 日期", (): void => {
  expect(parseValuation(payload, "pe")).toEqual([
    { dataDate: "2026-11-12", value: 17.1, percentile: 11.9 },
    { dataDate: "2026-11-13", value: 17.5, percentile: 12.34 },
  ]);
});

it("股息率百分数转成比率，倍数项保持不变", (): void => {
  const dividend = {
    data: { items: [{ tradeDate: "20261113", valuationValue: 4.4687, historicalPercentile: 80 }] },
  };
  const point = parseValuation(dividend, "dividendYield")[0];
  expect(point?.dataDate).toBe("2026-11-13");
  expect(point?.value).toBeCloseTo(0.044687, 12);
  expect(point?.percentile).toBe(80);
  expect(parseValuation(dividend, "pb")[0]?.value).toBe(4.4687);
});

it.each([null, undefined, {}, { data: null }, { data: {} }, { data: { items: [] } }])(
  "无数据返回空数组而不补 0 %j",
  (input): void => {
    expect(parseValuation(input, "pe")).toEqual([]);
  },
);

it("items 缺分位时用顶层分位补最新一行，其余保持 null", (): void => {
  const input = {
    data: {
      percentile: 55.5,
      items: [
        { tradeDate: "20261113", valuationValue: 2, historicalPercentile: null },
        { tradeDate: "20261112", valuationValue: 1, historicalPercentile: null },
      ],
    },
  };
  expect(parseValuation(input, "ps")).toEqual([
    { dataDate: "2026-11-12", value: 1, percentile: null },
    { dataDate: "2026-11-13", value: 2, percentile: 55.5 },
  ]);
});

it("顶层 valuation 与 items 不一致时以 items 为准", (): void => {
  const input = { data: { valuation: 999, percentile: 9, items: payload.data.items } };
  expect(parseValuation(input, "pe").at(-1)).toEqual({
    dataDate: "2026-11-13",
    value: 17.5,
    percentile: 12.34,
  });
});

it.each([
  { data: { items: [{ tradeDate: "20260230", valuationValue: 1 }] } },
  { data: { items: [{ tradeDate: "2026-11-13", valuationValue: 1 }] } },
  { data: { items: [{ tradeDate: "20261113", valuationValue: Number.NaN }] } },
  { data: { items: [{ tradeDate: "20261113", valuationValue: 1, historicalPercentile: 120 }] } },
  { data: { items: "20261113,1" } },
  { data: { items: [{ tradeDate: "20261113" }] } },
  "not json",
])("拒绝不可信响应 %j", (input): void => {
  expect(() => parseValuation(input, "pe")).toThrow();
});

it("四个指标各发一次上游请求并解析响应", async (): Promise<void> => {
  // 每次请求都要新的 Response，body 只能读一次。
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async (): Promise<Response> => Response.json(payload));
  const fetcher = createValuationFetcher({
    fetch: request,
    now: (): Date => new Date("2026-11-16T01:00:00Z"),
  });
  for (const metric of valuationMetrics)
    expect(await fetcher("930955.CSI", metric)).toHaveLength(2);
  const searches = request.mock.calls.map((call): Record<string, string> => {
    const url = call[0];
    if (!(url instanceof URL)) throw new Error("URL 未生成");
    return Object.fromEntries(url.searchParams);
  });
  expect(searches.map((search): string => search["valuationType"] ?? "")).toEqual([
    "PE",
    "PB",
    "PS",
    "DID",
  ]);
  expect(searches[0]).toEqual({
    securityCode: "930955.CSI",
    valuationType: "PE",
    timeInterval: "max",
    ts: String(new Date("2026-11-16T01:00:00Z").getTime()),
  });
  expect(request.mock.calls[0]?.[1]?.headers).toEqual({ accept: "application/json" });
});

it("上游无数据返回空数组而不报错", async (): Promise<void> => {
  for (const body of [{ code: "200", data: null }, { data: {} }])
    expect(
      await createValuationFetcher({ fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)) })(
        "515070.SH",
        "pe",
      ),
    ).toEqual([]);
});

it.each([
  (): Response => new Response("fail", { status: 500 }),
  (): Response => new Response("bad json"),
  (): Response => new Response(null),
  (): Response => new Response("x".repeat(8 * 1024 * 1024 + 1)),
  (): Response => Response.json({ data: { items: "broken" } }),
])("HTTP/JSON/空响应/大小上限映射为上游不可用", async (response): Promise<void> => {
  const fetcher = createValuationFetcher({ fetch: vi.fn<typeof fetch>().mockResolvedValue(response()) });
  await expect(fetcher("930955.CSI", "pe")).rejects.toMatchObject({ code: "upstream_unavailable" });
});

it("endpoint 协议无效时拒绝请求", async (): Promise<void> => {
  await expect(
    createValuationFetcher({ endpoint: "file:///x" })("930955.CSI", "pe"),
  ).rejects.toMatchObject({ code: "upstream_unavailable" });
});

it("上游 timeout 与调用方取消保持不同语义", async (): Promise<void> => {
  const waiting: typeof fetch = async (_input, options): Promise<Response> =>
    new Promise((_resolve, reject): void => {
      options?.signal?.addEventListener("abort", (): void => reject(options.signal?.reason), {
        once: true,
      });
    });
  await expect(
    createValuationFetcher({ fetch: waiting, timeoutMs: 5 })("930955.CSI", "pe"),
  ).rejects.toMatchObject({ code: "deadline_exceeded" });
  const controller = new AbortController();
  const promise = createValuationFetcher({ fetch: waiting })("930955.CSI", "pe", controller.signal);
  controller.abort(new Error("caller canceled"));
  await expect(promise).rejects.toThrow("caller canceled");
  await expect(
    createValuationFetcher()("930955.CSI", "pe", controller.signal),
  ).rejects.toThrow("caller canceled");
});
