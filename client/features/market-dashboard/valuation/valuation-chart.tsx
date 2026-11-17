import {
  useEffect,
  useRef,
  useState,
  type FC,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import {
  METRIC_LABELS,
  METRIC_UNITS,
  formatMetricValue,
  formatMonth,
  formatPercentile,
} from "./valuation-format";
import {
  VALUATION_RANGE_OPTIONS,
  lastDefinedIndex,
  splitLineSegments,
  type ValuationChartModel,
  type ValuationRange,
} from "./valuation-series";

const PADDING = { left: 34, right: 10, top: 10, bottom: 22 } as const;
const TIP_WIDTH = 176;
const GRID_LINES = [0, 50, 100] as const;

interface ValuationChartProps {
  model: ValuationChartModel;
  range: ValuationRange;
}

const useContainerWidth = (): [RefObject<HTMLDivElement | null>, number] => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(480);

  useEffect((): (() => void) | undefined => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = (): void => {
      setWidth(element.clientWidth > 0 ? element.clientWidth : 480);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return (): void => observer.disconnect();
  }, []);

  return [containerRef, width];
};

/**
 * 单条分位折线：纵轴是成立以来分位 0–100，横轴是所选范围。
 * 分位为 null 的点断开，不插值；悬停给当天日期、指标值与分位。
 */
export const ValuationChart: FC<ValuationChartProps> = (
  props: ValuationChartProps,
): ReactElement => {
  const { model, range } = props;
  const { metric } = model;
  const [containerRef, width] = useContainerWidth();
  const [hovered, setHovered] = useState<number | null>(null);

  const count = model.dates.length;
  const height = width >= 900 ? 288 : width >= 520 ? 248 : width >= 380 ? 208 : 176;
  const plotWidth = Math.max(24, width - PADDING.left - PADDING.right);
  const plotHeight = Math.max(24, height - PADDING.top - PADDING.bottom);
  const xOf = (index: number): number =>
    PADDING.left + (count > 1 ? (index / (count - 1)) * plotWidth : plotWidth / 2);
  const yOf = (percentile: number): number =>
    PADDING.top + (1 - Math.min(100, Math.max(0, percentile)) / 100) * plotHeight;
  const path = splitLineSegments(model.percentiles)
    .map((segment): string =>
      segment
        .map(
          (index, position): string =>
            `${position === 0 ? "M" : "L"}${xOf(index).toFixed(1)} ${yOf(model.percentiles[index] ?? 0).toFixed(1)}`,
        )
        .join(" "),
    )
    .join(" ");

  const rangeLabel =
    VALUATION_RANGE_OPTIONS.find((option): boolean => option.value === range)?.label ?? "全部";
  const tickIndexes =
    count === 0 ? [] : [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
  const latestIndex = lastDefinedIndex(model.percentiles);
  const hoveredDate = hovered == null ? null : (model.dates[hovered] ?? null);
  const tipLeft =
    hovered == null
      ? 0
      : Math.min(Math.max(0, xOf(hovered) + 12), Math.max(0, width - TIP_WIDTH));

  const handlePointerMove = (event: PointerEvent<SVGRectElement>): void => {
    if (count === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / Math.max(1, box.width);
    setHovered(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))));
  };

  return (
    <div className="valuation-chart" ref={containerRef}>
      {latestIndex == null ? (
        <p className="valuation-state">这个范围内没有可用的分位数据。</p>
      ) : (
        <>
          <svg
            className="valuation-chart-svg"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${METRIC_LABELS[metric]}分位走势图，范围${rangeLabel}，${model.dates[0]} 至 ${model.dates[count - 1]}`}
          >
            {GRID_LINES.map(
              (line): ReactElement => (
                <g key={line}>
                  <line
                    className="valuation-grid"
                    x1={PADDING.left}
                    x2={width - PADDING.right}
                    y1={yOf(line)}
                    y2={yOf(line)}
                  />
                  <text
                    className="valuation-axis"
                    x={PADDING.left - 8}
                    y={yOf(line) + 4}
                    textAnchor="end"
                  >
                    {line}
                  </text>
                </g>
              ),
            )}
            {tickIndexes.map(
              (index): ReactElement => (
                <text
                  key={index}
                  className="valuation-axis"
                  x={xOf(index)}
                  y={height - 6}
                  textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
                >
                  {formatMonth(model.dates[index] ?? "")}
                </text>
              ),
            )}
            <path className={`valuation-line valuation-line--${metric}`} d={path} />
            <circle
              className={`valuation-dot valuation-dot--${metric}`}
              cx={xOf(latestIndex)}
              cy={yOf(model.percentiles[latestIndex] ?? 0)}
              r={3}
            />
            {hovered != null && (
              <>
                <line
                  className="valuation-crosshair"
                  x1={xOf(hovered)}
                  x2={xOf(hovered)}
                  y1={PADDING.top}
                  y2={PADDING.top + plotHeight}
                />
                {model.percentiles[hovered] != null && (
                  <circle
                    className={`valuation-dot valuation-dot--${metric}`}
                    cx={xOf(hovered)}
                    cy={yOf(model.percentiles[hovered] ?? 0)}
                    r={4}
                  />
                )}
              </>
            )}
            <rect
              className="valuation-overlay"
              x={PADDING.left}
              y={PADDING.top}
              width={plotWidth}
              height={plotHeight}
              onPointerMove={handlePointerMove}
              onPointerLeave={(): void => setHovered(null)}
            />
          </svg>
          <p className="valuation-caption">纵轴是成立以来分位（0 到 100），悬停读当天的指标值与分位。</p>
          {hoveredDate && (
            <div className="valuation-tip" style={{ left: `${tipLeft}px` }} aria-hidden="true">
              <p className="valuation-tip-date">{hoveredDate}</p>
              <p className={`valuation-tip-row valuation-tip-row--${metric}`}>
                <span className="valuation-swatch" />
                <span className="valuation-tip-label">{METRIC_LABELS[metric]}</span>
                <span className="valuation-tip-value">
                  {formatMetricValue(metric, model.values[hovered ?? 0] ?? null)}
                  {METRIC_UNITS[metric]}
                </span>
                <span className="valuation-tip-percentile">
                  {formatPercentile(model.percentiles[hovered ?? 0] ?? null, 2)}
                </span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
