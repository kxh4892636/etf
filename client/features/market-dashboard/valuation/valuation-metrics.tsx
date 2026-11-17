import { valuationMetrics, type ValuationMetric, type ValuationSeries } from "@shared/market";
import type { FC, ReactElement } from "react";
import { METRIC_LABELS, METRIC_UNITS, formatMetricValue, formatPercentile } from "./valuation-format";

interface ValuationMetricsProps {
  series: readonly ValuationSeries[];
  selected: ValuationMetric;
  onSelect: (metric: ValuationMetric) => void;
}

/**
 * 四格读数：每格给当前值、单位与成立以来分位，整格可点选，选中项即下方曲线的指标。
 * 分位只用位置（0–100 刻度条）与中性墨色表达，不借涨红跌绿；选中态用 accent 竖线，不牺牲读数排版。
 */
export const ValuationMetrics: FC<ValuationMetricsProps> = (
  props: ValuationMetricsProps,
): ReactElement => {
  const { series, selected, onSelect } = props;

  return (
    <div className="valuation-metrics" role="group" aria-label="估值指标">
      {valuationMetrics.map((metric): ReactElement => {
        const latest = series.find((item): boolean => item.metric === metric)?.latest ?? null;
        const percentile = latest?.percentile ?? null;
        return (
          <button
            key={metric}
            type="button"
            className={`valuation-metric valuation-metric--${metric}`}
            aria-pressed={metric === selected}
            onClick={(): void => onSelect(metric)}
          >
            <span className="valuation-metric-head">
              <span className="valuation-swatch" aria-hidden="true" />
              <span className="valuation-label">{METRIC_LABELS[metric]}</span>
            </span>
            <span className="valuation-value-row">
              <span className="valuation-value">
                {formatMetricValue(metric, latest?.value ?? null)}
              </span>
              <span className="valuation-unit">{METRIC_UNITS[metric]}</span>
            </span>
            <span className="valuation-percentile-row">
              <span className="valuation-label">历史分位</span>
              <span className="valuation-percentile">{formatPercentile(percentile)}</span>
            </span>
            <span className="valuation-scale" aria-hidden="true">
              <span
                className="valuation-scale-fill"
                style={{ width: `${percentile == null ? 0 : Math.min(100, Math.max(0, percentile))}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
};
