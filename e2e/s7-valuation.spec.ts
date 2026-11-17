import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectDashboardReady, headingLocator, openDashboard } from "./support/dashboard";

/**
 * E2E-S7:估值区在 K 线下方，由两个面板组成——上面板是范围与四格读数(整格可选中)，
 * 下面板是所选指标的分位折线。范围与选中指标按证券独立，都不牵动 K 线。
 * 估值上游由 e2e/support/fixture-server.mjs 固定:12 个工作日、末行 2025-06-03。
 */
const DATA_DATE = "2025-06-03";
const FIRST_ALL_DATE = "2024-01-02";
/** 锚点是 2025-06-03,「1 年」的下界是 2024-06-03;fixture 没有该日,首点因此是 2024-06-04。 */
const FIRST_ONE_YEAR_DATE = "2024-06-04";

interface ExpectedMetric {
  metric: string;
  label: string;
  value: string;
  unit: string;
  percentile: string;
}

/** 红利低波100(930955.CSI,默认标的)的固定读数。 */
const RED_LOW_VOL_METRICS: readonly ExpectedMetric[] = [
  { metric: "pe", label: "市盈率", value: "12.32", unit: "倍", percentile: "37%" },
  { metric: "pb", label: "市净率", value: "1.25", unit: "倍", percentile: "44%" },
  { metric: "ps", label: "市销率", value: "2.15", unit: "倍", percentile: "58%" },
  { metric: "dividendYield", label: "股息率", value: "4.47", unit: "%", percentile: "81%" },
];

/** 中证红利质量(932315.CSI)的固定读数,与默认标的不同,用来验证切换后的变化。 */
const RED_QUALITY_METRICS: readonly ExpectedMetric[] = [
  { metric: "pe", label: "市盈率", value: "21.50", unit: "倍", percentile: "88%" },
  { metric: "pb", label: "市净率", value: "2.75", unit: "倍", percentile: "71%" },
  { metric: "ps", label: "市销率", value: "3.60", unit: "倍", percentile: "63%" },
  { metric: "dividendYield", label: "股息率", value: "2.50", unit: "%", percentile: "60%" },
];

const metricPanel = (page: Page, metric: string): Locator =>
  page.locator(`.valuation-metric--${metric}`);

const rangeItem = (page: Page, label: string): Locator =>
  page.locator(".valuation-controls .ant-segmented-item").filter({ hasText: label });

const chart = (page: Page): Locator => page.locator(".valuation-chart-svg");

const cardByTitle = (page: Page, title: string): Locator =>
  page.locator(".ant-card").filter({
    has: page.locator(".ant-card-head-title", { hasText: title }),
  });

/** 读某个分段控件里当前选中的项文本,不依赖 antd 的选中类名。 */
const checkedLabels = (scope: Locator): Promise<string[]> =>
  scope.locator(".ant-segmented-item").evaluateAll((items: Element[]): string[] =>
    items
      .filter((item): boolean => (item.querySelector("input") as HTMLInputElement | null)?.checked === true)
      .map((item): string => item.textContent?.trim() ?? ""),
  );

/** 四格读数:数值带固定两位小数,单位跟在后面,分位是整数百分数;标签在格内。 */
const expectMetrics = async (
  page: Page,
  expected: readonly ExpectedMetric[],
): Promise<void> => {
  for (const item of expected) {
    const panel = metricPanel(page, item.metric);
    await expect(panel).toContainText(item.label);
    await expect(panel.locator(".valuation-value")).toHaveText(item.value);
    await expect(panel.locator(".valuation-unit")).toHaveText(item.unit);
    await expect(panel.locator(".valuation-percentile")).toHaveText(item.percentile);
  }
};

test("S7 用户在 K 线下方看到双面板估值区并按指标读分位", async ({ page }) => {
  await openDashboard(page);
  await expect(headingLocator(page)).toBeVisible();
  await expectDashboardReady(page);

  // 两个面板:上面板是四格读数,下面板是分位折线,口径日期在下面板头部。
  const metricsCard = cardByTitle(page, "估值指标");
  const chartCard = cardByTitle(page, "估值分位");
  await expect(metricsCard).toBeVisible();
  await expect(chartCard).toBeVisible();
  await expect(chartCard.locator(".valuation-meta")).toHaveText(`口径 ${DATA_DATE}`);

  // 顺序:估值区整体在 K 线画布下方。
  const canvasBox = await page.locator("canvas").first().boundingBox();
  const metricsBox = await metricsCard.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(metricsBox).not.toBeNull();
  expect(metricsBox?.y ?? 0).toBeGreaterThan(canvasBox?.y ?? 0);

  // 四格读数 + 默认选中市盈率。
  await expectMetrics(page, RED_LOW_VOL_METRICS);
  await expect(metricPanel(page, "pe")).toHaveAttribute("aria-pressed", "true");
  for (const item of RED_LOW_VOL_METRICS.slice(1)) {
    await expect(metricPanel(page, item.metric)).toHaveAttribute("aria-pressed", "false");
  }

  // 默认只画一条线:市盈率分位,范围全部。
  await expect(chart(page).locator(".valuation-line")).toHaveCount(1);
  await expect(chart(page).locator(".valuation-line--pe")).toHaveCount(1);
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    `市盈率分位走势图，范围全部，${FIRST_ALL_DATE} 至 ${DATA_DATE}`,
  );

  // 点另一个读数面板:只换折线,读数与排版不动。
  await metricPanel(page, "pb").click();
  await expect(metricPanel(page, "pb")).toHaveAttribute("aria-pressed", "true");
  await expect(metricPanel(page, "pe")).toHaveAttribute("aria-pressed", "false");
  await expect(chart(page).locator(".valuation-line--pb")).toHaveCount(1);
  await expect(chart(page).locator(".valuation-line--pe")).toHaveCount(0);
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    `市净率分位走势图，范围全部，${FIRST_ALL_DATE} 至 ${DATA_DATE}`,
  );
  await expectMetrics(page, RED_LOW_VOL_METRICS);

  // 范围只换估值曲线:工具栏里的 K 线周期与范围保持「日 / 全部」。
  const toolbarCard = page.locator(".ant-card").first();
  expect(await checkedLabels(toolbarCard)).toEqual(["日", "全部"]);
  expect(await checkedLabels(metricsCard)).toEqual(["全部"]);
  await rangeItem(page, "1年").click();
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    `市净率分位走势图，范围1年，${FIRST_ONE_YEAR_DATE} 至 ${DATA_DATE}`,
  );
  expect(await checkedLabels(metricsCard)).toEqual(["1年"]);
  expect(await checkedLabels(toolbarCard)).toEqual(["日", "全部"]);
  // 指标选中态不受范围切换影响。
  await expect(metricPanel(page, "pb")).toHaveAttribute("aria-pressed", "true");

  await rangeItem(page, "全部").click();
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    `市净率分位走势图，范围全部，${FIRST_ALL_DATE} 至 ${DATA_DATE}`,
  );

  // 切换证券:读数整组换成另一只标的,视图状态按证券独立(回到默认的市盈率与全部)。
  const symbolInput = page.getByRole("combobox");
  await symbolInput.click();
  await symbolInput.fill("932315");
  await symbolInput.press("Enter");
  await expect(page.getByText("中证红利质量 · 932315.CSI")).toBeVisible();
  await expectMetrics(page, RED_QUALITY_METRICS);
  await expect(chartCard.locator(".valuation-meta")).toHaveText(`口径 ${DATA_DATE}`);
  await expect(metricPanel(page, "pe")).toHaveAttribute("aria-pressed", "true");
  await expect(metricPanel(page, "pb")).toHaveAttribute("aria-pressed", "false");
  expect(await checkedLabels(metricsCard)).toEqual(["全部"]);
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    `市盈率分位走势图，范围全部，${FIRST_ALL_DATE} 至 ${DATA_DATE}`,
  );

  await page.screenshot({ path: "e2e/evidence/s7-valuation.png", fullPage: true });
});
