# ETF 行情应用

单一 `repos/etf` 应用包含 React 看板、Hono 行情服务与双端共享契约。Node.js >=22.12.0，在 `repos/etf` 内执行：

```sh
pnpm install
pnpm run dev
```

打开 Vite 输出的地址（默认 http://localhost:5173）。同一命令用 `concurrently` 启动行情服务与看板，Ctrl+C 同时停止；后端默认监听 127.0.0.1:8080。也可在 `repos/etf` 内分别运行：

```sh
pnpm run dev:server
pnpm run dev:web
```

## 结构

```text
repos/etf/
├── client/                 # React + Vite + antd + Tailwind；libs 接 API，utils 放纯逻辑
├── server/                 # Hono 服务；按业务域 market 组织
│   └── market/
│       ├── handler/        # 控制层：Hono RPC 路由、Zod 校验、HTTP 错误映射
│       ├── service/        # 业务逻辑：用例、端口、域内错误
│       └── repository/     # 数据库接口 + SQLite 实现
├── shared/                 # 双端共享：ApiResponse/ApiCode 与行情、估值契约类型
├── migrations/             # Drizzle SQL 迁移（SQLite）
└── e2e/                    # 七组浏览器旅程与受管后端
```

- `server/market/service` 与 `server/market/repository` 不导入 Hono；只有 handler 与 `server/app.ts` 等入口/装配依赖框架。
- `MarketRepository` 是数据库接口，`repository/sqlite/` 是其中一种实现；替换 MySQL/PostgreSQL 时新增同接口实现并在 `server/server.ts` 组合根替换。

## API

Hono RPC 暴露，`AppType` 从 `server/app.ts` 导出，前端经 `hcWithType` 调用。所有成功/失败响应统一为：

```ts
interface ApiResponse<T> {
  code: number;
  message: string;
  extra: Record<string, any>;
  data: T;
}
```

- 成功：`code = 0`，`data` 为业务载荷。
- 失败：`data = null`，`code` 为业务码（1001 参数无效、1002 资源不存在、1003 取消、1004 内部、1005 上游不可用、1006 上游超时、1007 路由不存在），HTTP 状态由 Hono 单独返回。
- `GET /` 健康检查；`GET /api/securities` 证券目录，按目录（加入）顺序返回，首个是默认标的红利低波100；`GET /api/daily-bars?symbol=...` 前复权日线，另支持 `adjType=qfq`、`startDate`、`endDate`。
- `GET /api/valuations?symbol=...` 四个估值指标的完整序列与最新值，`data.series` 恒含 `pe`/`pb`/`ps`/`dividendYield` 四项（顺序固定），每项为 `{ metric, points, latest }`；点形如 `{ dataDate, value, percentile }`。

## 看板状态

周期、范围、均线文本、虚拟均线文本，以及估值的可见指标与曲线范围（1 年 / 3 年 / 5 年 / 全部，独立于 K 线周期），按证券独立保存在浏览器 `localStorage`（key `etf:dashboard:views:v1`）。切换 ETF 恢复各自状态；工具栏「重置」把当前 ETF 的全部字段恢复默认，不影响其他 ETF。localStorage 缺失、损坏、不可写，或旧记录缺估值字段时逐项回退默认，不阻断看板。

## 配置与数据

在 `repos/etf` 创建可选 `.env`，或使用进程环境变量（优先）：

```dotenv
PORT=8080
DATABASE_DSN=./data/etf.sqlite
```

运行 `dev`、`start`、E2E 时以 `repos/etf` 为工作目录；迁移目录按该工作目录解析。初次启动执行 SQL migrations 与证券幂等 seed。SQLite 使用 `better-sqlite3` + Drizzle ORM，原生预编译文件不需要本机编译。

```sh
pnpm --filter @kxh4892636/etf run build     # dist/client + dist/server + dist/shared
pnpm --filter @kxh4892636/etf run start     # node dist/server/main.js
pnpm --filter @kxh4892636/etf run test:coverage
pnpm --filter @kxh4892636/etf run test:e2e
pnpm --filter @kxh4892636/etf run sync:market       # 全量同步目录内五个证券的历史日线
pnpm --filter @kxh4892636/etf run sync:valuation    # 全量回填四个估值指标历史
pnpm --filter @kxh4892636/etf run db:generate
```

**日线**：`sync:market` 遍历证券目录，按上游 `count=-10000` 拉取全量、裁剪到上海昨日，事务写入 `daily_bars` 与 `trading_calendar` 并输出覆盖摘要；首次预填或缓存范围偏短时执行。当前五个证券的全量在 1665–5312 根之间（合计 18304 根），详见 [行情全量同步工作流](../../.agents/domains/etf/workflows/001-行情全量同步/001-行情全量同步.md)。

**估值**：`sync:valuation` 逐证券、逐指标请求上游 `/fundex-quote/index/valuation`（`timeInterval=max`，即上市起全部历史），整批 upsert 到 `security_valuation`（长表，迁移 0002）。查询 `GET /api/valuations` 时，若缓存最新日期早于应有工作日，会再拉一次全量补最新值（同一证券 10 分钟内只补拉一次，避免节假日或上游延迟时每次请求都重下四份全历史）；上游失败但已有缓存时退回缓存，没有缓存才报 1005/1006。估值按工作日发布，卡片右上角「口径日期」取数据日期（`dataDate`），不借行情最新日期。

**单位与分位**：PE/PB/PS 存倍数，股息率（上游 `DID`）上游给百分数、入库统一成比率（`0.0447` 即 4.47%）；`percentile` 是 0–100 的成立以来分位，上游缺失时留空、不补 0。ETF 走 `index` 通道没有估值数据，接口返回 1002（资源不存在），不换源也不估算。

修改存储 schema 后执行 `db:generate`，将 SQL、journal 与 snapshot 一并保留。E2E 共七组（含按 ETF 持久化状态与估值卡片），使用独立端口 15173/18181、临时 SQLite 与受控上游（日线与估值两路 fixture），结束回收自有进程；可通过 `ETF_E2E_FRONTEND_PORT`、`ETF_E2E_BACKEND_PORT` 改端口。日线仅支持前复权，历史范围受上游返回窗口限制。
