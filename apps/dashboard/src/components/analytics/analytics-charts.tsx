'use client';

/**
 * The Analytics section's charts (C164.9; owner decision B9 (b)): `d3-scale` and `d3-shape`
 * primitives with axes, groups and text drawn as plain React SVG, rendered in the browser only (the
 * server sends the figure and its caption, and the table beside it holds every figure). Each chart
 * is a `figure` whose caption states its finding in words, built from the suppressed answer only;
 * the SVG is `role="img"` with a name; series differ by pattern or dash as well as colour, and each
 * is labelled directly; a hidden cell is drawn as a hatched mark with its words, never as a value;
 * nothing is shown on hover only. Marks use the `primary` and `ink` tokens, 3:1 or more against the
 * surface (C171.2's graphics rule). The SVG attributes are attributes, not inline styles (C170).
 */
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { line } from 'd3-shape';
import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';

/** One plotted figure: a shown count, or `null` with the words of why not. */
export interface ChartPoint {
  readonly label: string;
  /** The shown count; `null` when hidden, not counted, or with no step data. */
  readonly value: number | null;
  /** What the point's label says: the count, "fewer than 11", "hidden", "no step data". */
  readonly words: string;
  /** Hidden by suppression: drawn hatched. */
  readonly suppressed: boolean;
}

export interface ChartSeries {
  readonly name: string;
  readonly points: readonly ChartPoint[];
}

export interface ChartProps {
  /** The SVG's accessible name. */
  readonly title: string;
  /** The finding in words, generated from the suppressed answer. */
  readonly caption: string;
  readonly series: readonly ChartSeries[];
  /** The threshold, whose small counts reach at most `threshold - 1`. */
  readonly threshold: number;
}

const noSubscription = () => () => undefined;

/** True in the browser, false while the server renders: the charts are client-only. */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const WIDTH = 640;
const MARGIN = { top: 16, right: 120, bottom: 40, left: 160 } as const;
/** Series 0 solid, series 1 striped (or dashed), and so on: never colour alone (1.4.1). */
const SERIES_CLASSES = ['fill-primary stroke-primary', 'fill-ink stroke-ink'] as const;
const DASHES = [undefined, '6 4'] as const;

function Patterns({ id }: { readonly id: string }) {
  return (
    <defs>
      <pattern id={`${id}-stripes`} width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0,6 L6,0" className="stroke-ink" strokeWidth="2" />
      </pattern>
      <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0,0 L8,8 M8,0 L0,8" className="stroke-ink-muted" strokeWidth="1.5" />
      </pattern>
    </defs>
  );
}

function Figure({
  title,
  caption,
  children,
}: {
  readonly title: string;
  readonly caption: string;
  readonly children: ReactNode;
}) {
  const inBrowser = useInBrowser();
  return (
    <figure className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      {inBrowser ? children : <p className="text-sm text-ink-muted">{title}</p>}
      <figcaption className="text-sm text-ink">{caption}</figcaption>
      <p className="text-xs text-ink-muted">{ANALYTICS_COPY.chart.legendNote}</p>
    </figure>
  );
}

function Legend({ series, id }: { readonly series: readonly ChartSeries[]; readonly id: string }) {
  return (
    <ul className="flex flex-wrap gap-4 text-sm text-ink" aria-hidden="true">
      {series.map((each, index) => (
        <li key={each.name} className="flex items-center gap-2">
          <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
            <rect
              width="24"
              height="12"
              className={SERIES_CLASSES[index % 2]}
              fill={index % 2 === 1 ? `url(#${id}-stripes)` : undefined}
            />
          </svg>
          {each.name}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal bars, one group per category, one bar per series, each labelled with its words. */
export function BarChart({ title, caption, series, threshold }: ChartProps) {
  const id = useId().replace(/:/g, '');
  const categories = series[0]?.points.map((point) => point.label) ?? [];
  const rowHeight = 22 * Math.max(series.length, 1) + 12;
  const height = MARGIN.top + MARGIN.bottom + rowHeight * Math.max(categories.length, 1);
  const shown = series.flatMap((each) => each.points.map((point) => point.value ?? 0));
  const max = Math.max(threshold - 1, ...shown, 1);
  const x = scaleLinear()
    .domain([0, max])
    .nice()
    .range([MARGIN.left, WIDTH - MARGIN.right]);
  const y = scaleBand()
    .domain(categories)
    .range([MARGIN.top, height - MARGIN.bottom])
    .paddingInner(0.25);
  const bar = scaleBand<number>()
    .domain(series.map((_, index) => index))
    .range([0, y.bandwidth()])
    .paddingInner(0.1);
  return (
    <Figure title={title} caption={caption}>
      <Legend series={series} id={id} />
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        className="h-auto w-full text-ink"
      >
        <title>{title}</title>
        <Patterns id={id} />
        {x.ticks(4).map((tick) => (
          <g key={tick} transform={`translate(${String(x(tick))},0)`}>
            <line y1={MARGIN.top} y2={height - MARGIN.bottom} className="stroke-line" />
            <text
              y={height - MARGIN.bottom + 16}
              textAnchor="middle"
              className="fill-ink-muted text-xs"
            >
              {tick.toLocaleString('en-US')}
            </text>
          </g>
        ))}
        {categories.map((category, row) => (
          <g key={category} transform={`translate(0,${String(y(category) ?? 0)})`}>
            <text
              x={MARGIN.left - 8}
              y={y.bandwidth() / 2}
              dy="0.35em"
              textAnchor="end"
              className="fill-ink text-xs"
            >
              {category}
            </text>
            {series.map((each, index) => {
              const point = each.points[row];
              if (point === undefined) {
                return null;
              }
              const top = bar(index) ?? 0;
              const end = point.suppressed
                ? point.words === ANALYTICS_COPY.cells.hidden
                  ? x(0) + 12
                  : x(threshold - 1)
                : x(point.value ?? 0);
              return (
                <g key={each.name}>
                  <rect
                    x={x(0)}
                    y={top}
                    width={Math.max(end - x(0), 0)}
                    height={bar.bandwidth()}
                    className={point.suppressed ? 'stroke-ink-muted' : SERIES_CLASSES[index % 2]}
                    fill={
                      point.suppressed
                        ? `url(#${id}-hatch)`
                        : index % 2 === 1
                          ? `url(#${id}-stripes)`
                          : undefined
                    }
                    strokeDasharray={point.suppressed ? '3 2' : undefined}
                  />
                  <text
                    x={end + 6}
                    y={top + bar.bandwidth() / 2}
                    dy="0.35em"
                    className="fill-ink text-xs"
                  >
                    {series.length > 1 ? `${each.name}: ${point.words}` : point.words}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={MARGIN.top}
          y2={height - MARGIN.bottom}
          className="stroke-ink"
        />
      </svg>
    </Figure>
  );
}

/** Lines over the periods, one per series, gaps where a cell is hidden, each labelled at its end. */
export function LineChart({ title, caption, series, threshold }: ChartProps) {
  const id = useId().replace(/:/g, '');
  const periods = series[0]?.points.map((point) => point.label) ?? [];
  const height = 280;
  const shown = series.flatMap((each) => each.points.map((point) => point.value ?? 0));
  const max = Math.max(threshold - 1, ...shown, 1);
  const x = scalePoint()
    .domain(periods)
    .range([MARGIN.left - 100, WIDTH - MARGIN.right])
    .padding(0.5);
  const y = scaleLinear()
    .domain([0, max])
    .nice()
    .range([height - MARGIN.bottom, MARGIN.top]);
  const path = line<ChartPoint>()
    .defined((point) => point.value !== null)
    .x((point) => x(point.label) ?? 0)
    .y((point) => y(point.value ?? 0));
  const every = Math.max(1, Math.ceil(periods.length / 6));
  return (
    <Figure title={title} caption={caption}>
      <Legend series={series} id={id} />
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        className="h-auto w-full text-ink"
      >
        <title>{title}</title>
        <Patterns id={id} />
        {y.ticks(4).map((tick) => (
          <g key={tick} transform={`translate(0,${String(y(tick))})`}>
            <line x1={MARGIN.left - 100} x2={WIDTH - MARGIN.right} className="stroke-line" />
            <text
              x={MARGIN.left - 106}
              dy="0.35em"
              textAnchor="end"
              className="fill-ink-muted text-xs"
            >
              {tick.toLocaleString('en-US')}
            </text>
          </g>
        ))}
        {periods.map((period, index) =>
          index % every === 0 ? (
            <text
              key={period}
              x={x(period)}
              y={height - MARGIN.bottom + 16}
              textAnchor="middle"
              className="fill-ink-muted text-xs"
            >
              {period}
            </text>
          ) : null,
        )}
        {series.map((each, index) => {
          const last = [...each.points].reverse().find((point) => point.value !== null);
          return (
            <g key={each.name}>
              <path
                d={path([...each.points]) ?? ''}
                fill="none"
                strokeWidth="2.5"
                className={SERIES_CLASSES[index % 2]}
                strokeDasharray={DASHES[index % 2]}
              />
              {each.points.map((point) =>
                point.value === null ? (
                  point.suppressed ? (
                    <rect
                      key={point.label}
                      x={(x(point.label) ?? 0) - 5}
                      y={y(threshold - 1)}
                      width="10"
                      height={Math.max(y(0) - y(threshold - 1), 4)}
                      fill={`url(#${id}-hatch)`}
                      className="stroke-ink-muted"
                      strokeDasharray="3 2"
                    />
                  ) : null
                ) : (
                  <circle
                    key={point.label}
                    cx={x(point.label)}
                    cy={y(point.value)}
                    r="3.5"
                    className={SERIES_CLASSES[index % 2]}
                  />
                ),
              )}
              {last?.value !== null && last !== undefined && (
                <text
                  x={(x(last.label) ?? 0) + 8}
                  y={y(last.value)}
                  dy={index % 2 === 0 ? '-0.4em' : '1em'}
                  className="fill-ink text-xs"
                >
                  {`${each.name}: ${last.words}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-ink-muted">
        {fillCopy(ANALYTICS_COPY.chart.suppressedMark, { threshold })}
      </p>
    </Figure>
  );
}
