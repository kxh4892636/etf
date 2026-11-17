import { useState, type FC, type ReactElement } from "react";
import { describe, expect, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import type { ValuationMetric, ValuationsResponse } from "@shared/market";
import { makeValuations } from "../../../test-support/render";
import { ValuationSection } from "./valuation-section";
import { DEFAULT_VALUATION_METRIC, type ValuationRange } from "./valuation-series";

interface HarnessProps {
  data: ValuationsResponse | undefined;
  isLoading?: boolean;
  isError?: boolean;
  initialMetric?: ValuationMetric;
  initialRange?: ValuationRange;
}

/** 与看板一致的最小受控外壳：单选指标与范围都写回本地状态。 */
const Harness: FC<HarnessProps> = (props: HarnessProps): ReactElement => {
  const [metric, setMetric] = useState<ValuationMetric>(
    props.initialMetric ?? DEFAULT_VALUATION_METRIC,
  );
  const [range, setRange] = useState<ValuationRange>(props.initialRange ?? "all");
  return (
    <ValuationSection
      data={props.data}
      isLoading={props.isLoading ?? false}
      isFetching={false}
      isError={props.isError ?? false}
      metric={metric}
      range={range}
      onSelectMetric={setMetric}
      onRangeChange={setRange}
    />
  );
};

const bodyText = (): string => document.body.textContent ?? "";

const metricPanel = (metric: ValuationMetric) =>
  page.getByRole("button", {
    name: new RegExp(
      { pe: "市盈率", pb: "市净率", ps: "市销率", dividendYield: "股息率" }[metric],
    ),
  });

/** 范围控件的选中项从真实 radio 状态读，避免依赖 antd 内部选中类名。 */
const selectedRangeLabel = (container: HTMLElement): string | null =>
  container
    .querySelector<HTMLInputElement>(".valuation-controls input:checked")
    ?.closest(".ant-segmented-item")
    ?.textContent?.trim() ?? null;

describe("ValuationSection", () => {
  test("成功响应渲染四格读数、口径日期与默认 PE 分位线", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={makeValuations(40)} />);

    await expect.poll(() => container.textContent ?? "").toContain("市盈率");
    const text = container.textContent ?? "";
    expect(text).toContain("市净率");
    expect(text).toContain("市销率");
    expect(text).toContain("股息率");
    // PE 10 → 22、PB 1.2 → 2.3、PS 1.5 → 2.7，股息率 0.06 → 0.04 换成百分数。
    expect(text).toContain("22.00");
    expect(text).toContain("2.30");
    expect(text).toContain("2.70");
    expect(text).toContain("4.00");
    expect(text).toContain("100%");
    // 口径日期落下方折线图面板的头部。
    expect(container.querySelector(".valuation-meta")?.textContent).toBe("口径 2024-02-10");
    // 默认只画一条线，且是 PE。
    expect(container.querySelectorAll("path.valuation-line")).toHaveLength(1);
    expect(container.querySelector(".valuation-line--pe")).not.toBeNull();
    expect(container.querySelector(".valuation-state")).toBeNull();
    await expect.element(metricPanel("pe")).toHaveAttribute("aria-pressed", "true");
    await expect.element(metricPanel("pb")).toHaveAttribute("aria-pressed", "false");
    expect(selectedRangeLabel(container)).toBe("全部");
  });

  test("加载中给出骨架与读屏状态", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={undefined} isLoading />);

    await expect.poll(bodyText).toContain("估值数据加载中");
    expect(container.querySelector(".valuation-skeleton-block")).not.toBeNull();
    expect(container.querySelector("svg.valuation-chart-svg")).toBeNull();
  });

  test("没有估值数据时给出空状态", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={makeValuations(0)} />);

    await expect.poll(() => container.textContent ?? "").toContain("该证券暂无估值数据");
    expect(container.querySelector("path.valuation-line")).toBeNull();
    expect(container.querySelector(".valuation-metric")).toBeNull();
  });

  test("请求失败时只在这一区提示", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={undefined} isError />);

    await expect.poll(() => container.textContent ?? "").toContain("估值数据加载失败");
    expect(container.textContent).toContain("K 线不受影响");
    expect(container.querySelector(".valuation-metric")).toBeNull();
  });

  test("点选指标只换曲线，四格读数始终保留", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={makeValuations(20)} />);

    await expect.element(metricPanel("pb")).toBeVisible();
    await metricPanel("pb").click();

    await expect.element(metricPanel("pb")).toHaveAttribute("aria-pressed", "true");
    await expect.element(metricPanel("pe")).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector(".valuation-line--pb")).not.toBeNull();
    expect(container.querySelector(".valuation-line--pe")).toBeNull();
    expect(container.querySelectorAll("path.valuation-line")).toHaveLength(1);
    expect(container.textContent).toContain("22.00");

    await metricPanel("pe").click();
    await expect.element(metricPanel("pe")).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".valuation-line--pe")).not.toBeNull();
  });

  test("范围切换只改曲线窗口，与 K 线周期无关", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={makeValuations(900, { startDate: "2022-01-03" })} />);

    await expect.element(page.getByRole("img")).toHaveAccessibleName(/范围全部，2022-01-03/);
    await page.getByText("1年", { exact: true }).click();
    await expect.element(page.getByRole("img")).toHaveAccessibleName(/范围1年，2023-/);
    expect(selectedRangeLabel(container)).toBe("1年");
    // 指标选中态不受范围切换影响。
    await expect.element(metricPanel("pe")).toHaveAttribute("aria-pressed", "true");

    await page.getByText("全部", { exact: true }).click();
    await expect.element(page.getByRole("img")).toHaveAccessibleName(/范围全部，2022-01-03/);
  });

  test("上游缺分位时只显示读数，不补零也不画线", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(
      <Harness data={makeValuations(10, { dropPercentiles: true })} />,
    );

    await expect.poll(bodyText).toContain("没有可用的分位数据");
    expect(container.querySelector("path.valuation-line")).toBeNull();
    expect(container.textContent).toContain("历史分位");
  });

  test("悬停曲线给出当天读数与分位", { timeout: 20_000 }, async (): Promise<void> => {
    const { container } = await render(<Harness data={makeValuations(30)} />);
    const overlay = container.querySelector(".valuation-overlay");
    expect(overlay).not.toBeNull();

    const box = (overlay as SVGRectElement).getBoundingClientRect();
    overlay?.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );

    await expect.poll(() => container.querySelector(".valuation-tip") !== null).toBe(true);
    expect(container.querySelector(".valuation-tip-date")?.textContent).toMatch(/^2024-/);
    expect(container.querySelector(".valuation-tip-row--pe")).not.toBeNull();
    expect(container.querySelector(".valuation-tip-percentile")?.textContent).toMatch(/^\d+\.\d{2}%$/);
  });
});
