import { createServer } from "node:http";
import { startServer } from "../../dist/server/server.js";
import { createRemoteFetcher } from "../../dist/server/libs/hongsehuojian/hongsehuojian.js";
import { createValuationFetcher } from "../../dist/server/libs/hongsehuojian/valuation.js";
const rows = [];
for (let index = 0; index < 1000; index++) {
  const date = new Date(Date.UTC(2022, 0, 3 + index));
  const open = 100 + index * 0.1;
  rows.push(
    [
      date.toISOString().slice(0, 10),
      open,
      open + 2,
      open - 1,
      open + 1,
      100000,
      10000000,
      1,
      1,
      "一",
    ].join(","),
  );
}
/** 估值上游的固定历史：12 个工作日跨两年，让「1 年」与「全部」选出不同起点。 */
const valuationDates = [
  "20240102",
  "20240201",
  "20240301",
  "20240401",
  "20240506",
  "20240604",
  "20250102",
  "20250205",
  "20250304",
  "20250401",
  "20250506",
  "20250603",
];
/**
 * 两个标的的四指标固定序列：values 与 valuationDates 一一对应，percentiles 是 0–100 分位。
 * DID（股息率）按上游口径给百分数，例如 4.47 表示 4.47%，服务端换算成 0.0447。
 */
const valuationFixtures = {
  "930955.CSI": {
    PE: {
      values: [9.8, 10.2, 10.5, 10.9, 11.1, 11.0, 11.4, 11.7, 12.0, 12.1, 12.2, 12.32],
      percentiles: [10, 15, 20, 25, 28, 26, 30, 32, 34, 35, 36, 37],
    },
    PB: {
      values: [0.95, 0.99, 1.02, 1.05, 1.08, 1.07, 1.1, 1.14, 1.18, 1.2, 1.22, 1.25],
      percentiles: [12, 18, 22, 26, 29, 27, 33, 36, 40, 41, 42, 44],
    },
    PS: {
      values: [1.75, 1.79, 1.82, 1.86, 1.9, 1.88, 1.93, 1.97, 2.02, 2.06, 2.1, 2.15],
      percentiles: [20, 24, 28, 32, 36, 33, 40, 44, 48, 52, 55, 58],
    },
    DID: {
      values: [6.8, 6.6, 6.4, 6.2, 6.1, 6.0, 5.6, 5.4, 5.1, 4.9, 4.7, 4.47],
      percentiles: [24, 28, 32, 36, 40, 38, 46, 52, 58, 64, 72, 81],
    },
  },
  "932315.CSI": {
    PE: {
      values: [18.2, 18.6, 19.0, 19.4, 19.8, 20.1, 20.4, 20.7, 21.0, 21.2, 21.35, 21.5],
      percentiles: [60, 63, 66, 69, 72, 70, 76, 79, 82, 84, 86, 88],
    },
    PB: {
      values: [2.2, 2.24, 2.28, 2.32, 2.36, 2.4, 2.44, 2.5, 2.58, 2.64, 2.7, 2.75],
      percentiles: [40, 44, 48, 52, 56, 54, 60, 64, 66, 68, 70, 71],
    },
    PS: {
      values: [2.9, 2.95, 3.0, 3.05, 3.1, 3.15, 3.2, 3.28, 3.38, 3.45, 3.52, 3.6],
      percentiles: [30, 34, 38, 42, 46, 44, 50, 54, 57, 60, 61, 63],
    },
    DID: {
      values: [4.2, 4.0, 3.8, 3.6, 3.4, 3.2, 3.0, 2.9, 2.8, 2.7, 2.6, 2.5],
      percentiles: [8, 12, 16, 20, 24, 22, 32, 38, 44, 50, 56, 60],
    },
  },
};
const sendJson = (res, body) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};
/** 估值响应：顶层 valuation/percentile 与 items 末行一致，items 按日期升序。 */
const valuationPayload = (fixture) => ({
  data: {
    valuation: fixture.values.at(-1),
    percentile: fixture.percentiles.at(-1),
    items: valuationDates.map((tradeDate, index) => ({
      tradeDate,
      valuationValue: fixture.values[index],
      historicalPercentile: fixture.percentiles[index],
    })),
  },
});
const upstream = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/fundex-quote/index/valuation") {
    const fixture = valuationFixtures[url.searchParams.get("securityCode")]?.[
      url.searchParams.get("valuationType")
    ];
    // 未知标的或指标按上游口径返回空 data，不返回 200 的假数据。
    if (!fixture) return sendJson(res, { data: null });
    return sendJson(res, valuationPayload(fixture));
  }
  if (url.pathname !== "/fundex-quote/line/kline") {
    res.statusCode = 404;
    return res.end();
  }
  const symbol = url.searchParams.get("securityCode");
  return sendJson(res, {
    securityCode: symbol,
    columns: "tradeDate,open,high,low,close,volume,amount,change,changePercent,week",
    items: rows.join(";"),
  });
});
upstream.listen(0, "127.0.0.1", () => {
  const port = upstream.address().port;
  const origin = "http://127.0.0.1:" + port;
  const running = startServer(
    {
      port: Number(process.env.ETF_E2E_BACKEND_PORT ?? "18181"),
      databaseDsn: process.env.DATABASE_DSN,
    },
    createRemoteFetcher({ endpoint: origin + "/fundex-quote/line/kline" }),
    createValuationFetcher({ endpoint: origin + "/fundex-quote/index/valuation" }),
  );
  running.server.on("error", (error) => {
    console.error(error);
    upstream.close();
    process.exitCode = 1;
  });
  const stop = () => {
    void running.close().finally(() => upstream.close());
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
});
