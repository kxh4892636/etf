import { valuationMetrics, type ValuationMetric } from "@shared/market";
import { Card, Segmented } from "antd";
import { useMemo, type FC, type ReactElement } from "react";
import type { GetValuationsResponse } from "@/libs/api/client";
import { ValuationChart } from "./valuation-chart";
import { ValuationMetrics } from "./valuation-metrics";
import {
  buildValuationChartModel,
  findLatestDataDate,
  VALUATION_RANGE_OPTIONS,
  type ValuationRange,
} from "./valuation-series";
import "./valuation.css";

interface ValuationSectionProps {
  data: GetValuationsResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  metric: ValuationMetric;
  range: ValuationRange;
  onSelectMetric: (metric: ValuationMetric) => void;
  onRangeChange: (range: ValuationRange) => void;
}

const ValuationSkeleton: FC = (): ReactElement => (
  <div className="valuation-metrics" aria-hidden="true">
    {valuationMetrics.map(
      (metric): ReactElement => (
        <div key={metric} className="valuation-metric">
          <span className="valuation-skeleton-line valuation-skeleton-line--label" />
          <span className="valuation-skeleton-line valuation-skeleton-line--value" />
          <span className="valuation-skeleton-line" />
        </div>
      ),
    )}
  </div>
);

interface RangeControlProps {
  range: ValuationRange;
  onRangeChange: (range: ValuationRange) => void;
}

const RangeControl: FC<RangeControlProps> = (props: RangeControlProps): ReactElement => (
  <div className="valuation-controls">
    <span className="valuation-label">范围</span>
    <Segmented<ValuationRange>
      aria-label="估值范围"
      value={props.range}
      options={VALUATION_RANGE_OPTIONS.map(
        (option): { value: ValuationRange; label: string } => ({
          value: option.value,
          label: option.label,
        }),
      )}
      onChange={props.onRangeChange}
    />
  </div>
);

/**
 * 估值区：K 线下方两个面板，与 K 线的卡片同宽同距。
 * 上面板是范围控件 + 四格读数（整格可选中），下面板是所选指标的分位折线，口径日期在下方面板头部。
 * 加载、空与失败三种状态都在本区内部收口，不牵动同页的 K 线。
 */
export const ValuationSection: FC<ValuationSectionProps> = (
  props: ValuationSectionProps,
): ReactElement => {
  const { data, isLoading, isFetching, isError, metric, range } = props;
  const { onSelectMetric, onRangeChange } = props;
  const series = useMemo(() => data?.series ?? [], [data]);
  const latestDate = useMemo(() => findLatestDataDate(series), [series]);
  const hasData = series.some((item): boolean => item.latest != null);
  const model = useMemo(
    () => buildValuationChartModel({ series, metric, range }),
    [series, metric, range],
  );
  const state: "loading" | "error" | "empty" | "full" = isError
    ? "error"
    : hasData
      ? "full"
      : isLoading || isFetching
        ? "loading"
        : "empty";

  if (state === "error" || state === "empty") {
    return (
      <Card title="估值指标">
        <p className="valuation-state">
          {state === "error"
            ? "估值数据加载失败，K 线不受影响；刷新页面可以重试。"
            : "该证券暂无估值数据。"}
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card title="估值指标">
        <div className="valuation-top">
          <RangeControl range={range} onRangeChange={onRangeChange} />
          {state === "loading" ? (
            <>
              <p className="valuation-sr" role="status">
                估值数据加载中
              </p>
              <ValuationSkeleton />
            </>
          ) : (
            <ValuationMetrics series={series} selected={metric} onSelect={onSelectMetric} />
          )}
        </div>
      </Card>
      <Card
        title="估值分位"
        extra={latestDate ? <span className="valuation-meta">口径 {latestDate}</span> : null}
      >
        {state === "loading" ? (
          <span className="valuation-skeleton-block" aria-hidden="true" />
        ) : (
          <ValuationChart model={model} range={range} />
        )}
      </Card>
    </>
  );
};
