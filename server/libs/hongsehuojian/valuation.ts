import { z } from "zod";
import type { ValuationMetric, ValuationPoint } from "../../../shared/market.ts";
import { isValidTradeDate } from "../../../shared/utils/trade-date.ts";
import { MarketError } from "../../market/service/errors.ts";
import type { RemoteValuationFetcher } from "../../market/service/valuation-service.ts";
import { limitedJson } from "./hongsehuojian.ts";

interface FetchOptions {
  fetch?: typeof fetch;
  endpoint?: string;
  now?: () => Date;
  timeoutMs?: number;
}

/** 内部指标名到上游 valuationType 的映射；DID 是股息率。 */
const upstreamType: Record<ValuationMetric, string> = {
  pe: "PE",
  pb: "PB",
  ps: "PS",
  dividendYield: "DID",
};

const isoDate = z
  .string()
  .regex(/^\d{8}$/, "日期格式无效")
  .transform(
    (value: string): string =>
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
  )
  .refine(isValidTradeDate, "日期无效");

const percentile = z.number().finite().min(0).max(100);

const itemSchema = z.object({
  tradeDate: isoDate,
  valuationValue: z.number().finite(),
  historicalPercentile: percentile.nullish(),
});

const payloadSchema = z.object({
  valuation: z.number().finite().nullish(),
  percentile: percentile.nullish(),
  items: z.array(itemSchema),
});

const envelopeSchema = z.object({ data: z.unknown().optional() }).passthrough().nullish();

const isEmptyObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

/**
 * 解析估值响应。
 * data 为 null/缺失（无效类型、未知代码）或 {}（ETF 走 index 通道）都表示无数据，返回空数组。
 * 顶层 valuation 与 items[0] 本应一致（001 实测一致），不一致时以 items 为准；
 * 顶层 percentile 只在 items 缺失分位时补最新一行。
 */
export const parseValuation = (input: unknown, metric: ValuationMetric): ValuationPoint[] => {
  const data = envelopeSchema.parse(input)?.data;
  if (data === null || data === undefined || isEmptyObject(data)) return [];
  const payload = payloadSchema.parse(data);
  // 股息率上游给百分数（4.4687 即 4.47%），入库统一成比率。
  const scale = metric === "dividendYield" ? 100 : 1;
  const points = payload.items
    .map(
      (item): ValuationPoint => ({
        dataDate: item.tradeDate,
        value: item.valuationValue / scale,
        percentile: item.historicalPercentile ?? null,
      }),
    )
    .sort((left: ValuationPoint, right: ValuationPoint): number =>
      left.dataDate.localeCompare(right.dataDate),
    );
  const latest = points.at(-1);
  if (latest && latest.percentile === null && payload.percentile != null)
    points[points.length - 1] = { ...latest, percentile: payload.percentile };
  return points;
};

/** 上游估值取数：一次一个指标，接口只有 timeInterval=max 有数据。 */
export const createValuationFetcher =
  (options: FetchOptions = {}): RemoteValuationFetcher =>
  async (
    symbol: string,
    metric: ValuationMetric,
    signal?: AbortSignal,
  ): Promise<ValuationPoint[]> => {
    const now = (options.now ?? ((): Date => new Date()))();
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15000);
    try {
      signal?.throwIfAborted();
      const url = new URL(
        options.endpoint ?? "https://hongsehuojian.com/fundex-quote/index/valuation",
      );
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("上游地址协议无效");
      url.search = new URLSearchParams({
        securityCode: symbol,
        valuationType: upstreamType[metric],
        timeInterval: "max",
        ts: String(now.getTime()),
      }).toString();
      const response = await (options.fetch ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("上游 HTTP " + response.status);
      }
      return parseValuation(await limitedJson(response), metric);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted) throw new MarketError("deadline_exceeded", "上游请求超时");
      throw new MarketError("upstream_unavailable", "上游估值不可用", { cause: error });
    }
  };
