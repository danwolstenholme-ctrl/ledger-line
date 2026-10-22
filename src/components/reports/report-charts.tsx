import type { ReactNode } from "react";
import Link from "@/components/navigation/navigation-link";

import { axisTicks } from "@/lib/domain/billing-report";
import { cn } from "@/lib/utils";

/**
 * Charts for the reports, drawn in HTML rather than a chart library: bars are
 * boxes sized as a share of the scale, so they reflow at any width with no
 * script. Hovering or focusing a column shows its figures; every chart also
 * opens as a table, which is where the exact values always live.
 *
 * Marks are thin and square at the baseline, gridlines are solid hairlines,
 * and text never wears the series colour — a swatch beside it carries that.
 */

export type ChartSeries = { key: string; label: string; swatch: string };
/** `href` makes the column open the figures behind it, such as that month's profit and loss. */
export type ChartColumn = { key: string; label: string; title: string; values: Record<string, number>; href?: string };

const PLOT = "h-44";

export function ChartFrame({ title, hint, legend, children, table }: {
  title: string; hint?: string; legend?: ChartSeries[]; children: ReactNode; table: ReactNode;
}) {
  return (
    <figure className="ll-panel min-w-0 overflow-hidden">
      <figcaption className="border-hairline flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <span className="text-ink text-[13px] font-semibold">{title}</span>
          {hint ? <span className="text-ink-faint text-[11.5px]">{hint}</span> : null}
        </span>
        {legend && legend.length > 1 ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {legend.map(series => (
              <span key={series.key} className="text-ink-muted inline-flex items-center gap-1.5 text-[11.5px]">
                <span aria-hidden className={cn("size-2.5 rounded-[1px]", series.swatch)} />{series.label}
              </span>
            ))}
          </span>
        ) : null}
      </figcaption>
      <div className="px-4 pt-4 pb-3">{children}</div>
      <details className="border-hairline border-t">
        <summary className="text-brand cursor-pointer px-4 py-2 text-[12px] font-medium touch:py-3 touch:text-[13px]">Show as table</summary>
        <div className="overflow-x-auto px-4 pb-3">{table}</div>
      </details>
    </figure>
  );
}

/** Columns grouped by period, one bar per series, on one euro axis. */
export function ColumnChart({ series, columns, format, formatTick, label, whole = false }: {
  series: ChartSeries[];
  columns: ChartColumn[];
  format: (value: number) => string;
  formatTick: (value: number) => string;
  /** What one column is, for the screen-reader description of each. */
  label: string;
  /** The values are counts, so the axis steps in whole numbers. */
  whole?: boolean;
}) {
  const max = Math.max(0, ...columns.flatMap(column => series.map(item => column.values[item.key] ?? 0)));
  const ticks = axisTicks(max, { whole });
  const top = ticks[ticks.length - 1] || 1;
  const share = (value: number) => `${Math.max(0, Math.min(100, (value / top) * 100))}%`;
  const last = columns.length - 1;

  return (
    <div className="flex min-w-0 gap-2">
      <div aria-hidden className={cn("text-ink-faint relative w-12 shrink-0 text-right text-[10.5px] tabular-nums", PLOT)}>
        {ticks.map(tick => <span key={tick} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: share(tick) }}>{formatTick(tick)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("relative", PLOT)}>
          {ticks.map(tick => <span key={tick} aria-hidden className={cn("absolute inset-x-0 border-t", tick === 0 ? "border-hairline-strong" : "border-hairline")} style={{ bottom: share(tick) }} />)}
          <ol aria-label={label} className="absolute inset-0 flex items-end">
            {columns.map((column, index) => {
              const summary = `${column.title}: ${series.map(item => `${item.label.toLowerCase()} ${format(column.values[item.key] ?? 0)}`).join(", ")}`;
              const cell = "group focus:bg-brand-50/60 relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] outline-none hover:bg-brand-50/60";
              const body = <>
                  {series.map(item => (
                    <span key={item.key} aria-hidden style={{ height: share(column.values[item.key] ?? 0) }}
                      className={cn("w-full max-w-[18px] rounded-t-[2px] transition-opacity group-hover:opacity-85", item.swatch)} />
                  ))}
                  <span role="tooltip" className={cn(
                    "border-hairline-strong bg-surface pointer-events-none absolute top-0 z-20 hidden w-max min-w-36 rounded-md border px-2.5 py-2 text-left shadow-md group-hover:block group-focus:block",
                    index < 2 ? "left-0" : index > last - 2 ? "right-0" : "left-1/2 -translate-x-1/2",
                  )}>
                    <span className="text-ink-muted block text-[11px]">{column.title}</span>
                    {series.map(item => (
                      <span key={item.key} className="mt-1 flex items-center gap-2 text-[12px]">
                        <span aria-hidden className={cn("h-0.5 w-3 shrink-0", item.swatch)} />
                        <span className="text-ink font-semibold tabular-nums">{format(column.values[item.key] ?? 0)}</span>
                        <span className="text-ink-muted">{item.label}</span>
                      </span>
                    ))}
                    {column.href ? <span className="text-brand mt-1.5 block text-[11px] font-medium">Open the figures</span> : null}
                  </span>
              </>;
              return column.href
                ? <li key={column.key} className="flex h-full min-w-0 flex-1"><Link href={column.href} aria-label={`${summary}. Open the figures`} className={cn(cell, "cursor-pointer")}>{body}</Link></li>
                : <li key={column.key} tabIndex={0} aria-label={summary} className={cell}>{body}</li>;
            })}
          </ol>
        </div>
        <div aria-hidden className="mt-1.5 flex">
          {columns.map((column, index) => (
            <span key={column.key} className={cn("text-ink-faint min-w-0 flex-1 truncate text-center text-[10.5px]",
              // A long period shows every other month so the labels never collide.
              columns.length > 12 && index % 2 === 1 && "invisible")}>{column.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export type LinePoint = { key: string; label: string; title: string; value: number; detail?: string; href?: string };

/** The axis for values that may fall below nothing: zero, and round steps either side of it. */
function signedTicks(values: number[]) {
  const up = axisTicks(Math.max(0, ...values));
  const down = Math.min(0, ...values) < 0 ? axisTicks(-Math.min(0, ...values)).slice(1).map(tick => -tick).reverse() : [];
  return [...down, ...up];
}

/**
 * One series over time as a 2px line, on the same grid as the column charts.
 * Hovering or focusing a month shows its marker, a guide and its figures; the
 * latest point keeps its marker so the line ends somewhere definite.
 */
export function LineChart({ points, format, formatTick, label, stroke = "var(--color-chart-billed)", dot = "bg-chart-billed" }: {
  points: LinePoint[]; format: (value: number) => string; formatTick: (value: number) => string; label: string;
  /** The line's colour, and the same colour as a class for its markers. */
  stroke?: string; dot?: string;
}) {
  const ticks = signedTicks(points.map(point => point.value));
  const bottom = ticks[0], top = ticks[ticks.length - 1];
  const span = top - bottom || 1;
  const height = (value: number) => ((value - bottom) / span) * 100;
  const across = (index: number) => ((index + 0.5) / Math.max(1, points.length)) * 100;
  const last = points.length - 1;
  return (
    <div className="flex min-w-0 gap-2">
      <div aria-hidden className={cn("text-ink-faint relative w-12 shrink-0 text-right text-[10.5px] tabular-nums", PLOT)}>
        {ticks.map(tick => <span key={tick} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${height(tick)}%` }}>{formatTick(tick)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("relative", PLOT)}>
          {ticks.map(tick => <span key={tick} aria-hidden className={cn("absolute inset-x-0 border-t", tick === 0 ? "border-hairline-strong" : "border-hairline")} style={{ bottom: `${height(tick)}%` }} />)}
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <polyline fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
              points={points.map((point, index) => `${across(index)},${100 - height(point.value)}`).join(" ")} />
          </svg>
          <ol aria-label={label} className="absolute inset-0 flex">
            {points.map((point, index) => {
              const summary = `${point.title}: ${format(point.value)}${point.detail ? `, ${point.detail}` : ""}`;
              const body = <>
                <span aria-hidden className="border-hairline-strong absolute inset-y-0 left-1/2 hidden border-l border-dashed group-hover:block group-focus:block" />
                <span aria-hidden style={{ bottom: `${height(point.value)}%` }}
                  className={cn("ring-surface absolute left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full ring-2", dot, index === last ? "block" : "hidden group-hover:block group-focus:block")} />
                <span role="tooltip" className={cn(
                  "border-hairline-strong bg-surface pointer-events-none absolute top-0 z-20 hidden w-max min-w-36 rounded-md border px-2.5 py-2 text-left shadow-md group-hover:block group-focus:block",
                  index < 2 ? "left-0" : index > last - 2 ? "right-0" : "left-1/2 -translate-x-1/2",
                )}>
                  <span className="text-ink-muted block text-[11px]">{point.title}</span>
                  <span className="text-ink mt-1 block text-[12px] font-semibold tabular-nums">{format(point.value)}</span>
                  {point.detail ? <span className="text-ink-muted mt-0.5 block text-[11.5px]">{point.detail}</span> : null}
                  {point.href ? <span className="text-brand mt-1.5 block text-[11px] font-medium">Open the figures</span> : null}
                </span>
              </>;
              return point.href
                ? <li key={point.key} className="flex h-full min-w-0 flex-1"><Link href={point.href} aria-label={`${summary}. Open the figures`} className="group relative block h-full w-full cursor-pointer outline-none">{body}</Link></li>
                : <li key={point.key} tabIndex={0} aria-label={summary} className="group relative h-full min-w-0 flex-1 outline-none">{body}</li>;
            })}
          </ol>
        </div>
        <div aria-hidden className="mt-1.5 flex">
          {points.map((point, index) => (
            <span key={point.key} className={cn("text-ink-faint min-w-0 flex-1 truncate text-center text-[10.5px]", points.length > 12 && index % 2 === 1 && "invisible")}>{point.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export type StackRow = { key: string; label: string; href?: string; total: number; values: Record<string, number>; note?: string };

/**
 * Totals split into ordered parts, one bar each on a shared scale, so two
 * totals compare by length and their parts by shade. Parts are separated by
 * a 2px gap; each shows its figure on hover or focus.
 */
export function StackedBars({ series, rows, format, label }: { series: ChartSeries[]; rows: StackRow[]; format: (value: number) => string; label: string }) {
  const max = Math.max(0, ...rows.map(row => row.total));
  return (
    <ul aria-label={label} className="space-y-4">
      {rows.map(row => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px]">
              {row.href ? <Link href={row.href} className="text-ink hover:text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{row.label}</Link> : <span className="text-ink font-medium">{row.label}</span>}
              {row.note ? <span className="text-ink-faint ml-2 text-[11.5px]">{row.note}</span> : null}
            </span>
            <span className="text-ink shrink-0 text-[12.5px] font-semibold tabular-nums">{format(row.total)}</span>
          </div>
          <Bar href={row.href} label={row.label}>
          <div className="mt-1.5 flex h-4 gap-[2px]" style={{ width: max > 0 ? `${Math.max(2, (row.total / max) * 100)}%` : "0%" }}>
            {series.filter(item => (row.values[item.key] ?? 0) > 0).map(item => (
              <span key={item.key} tabIndex={row.href ? undefined : 0} aria-label={`${row.label}, ${item.label}: ${format(row.values[item.key])}`}
                className={cn("group relative h-full min-w-[3px] outline-none first:rounded-l-[2px] last:rounded-r-[2px] focus-visible:ring-2 focus-visible:ring-ring/40", item.swatch)}
                style={{ flexGrow: row.values[item.key], flexBasis: 0 }}>
                <span role="tooltip" className="border-hairline-strong bg-surface pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden w-max rounded-md border px-2.5 py-1.5 text-left shadow-md group-hover:block group-focus:block">
                  <span className="text-ink-muted block text-[11px]">{item.label}</span>
                  <span className="text-ink block text-[12px] font-semibold tabular-nums">{format(row.values[item.key])}</span>
                </span>
              </span>
            ))}
          </div>
          </Bar>
        </li>
      ))}
    </ul>
  );
}

/** A bar that opens what it is made of, with room to press on a touch screen. */
function Bar({ href, label, children }: { href?: string; label: string; children: ReactNode }) {
  return href ? <Link href={href} aria-label={`${label}: open the report`} className="block cursor-pointer rounded-sm outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40 touch:py-3">{children}</Link> : <>{children}</>;
}

export type BarRow = { key: string; label: string; href?: string | null; value: number; display: string; note?: string; swatch: string; tone?: "critical" | "faint" };

/** Horizontal bars with the value at the tip: a ranked list read as lengths. */
export function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  const max = Math.max(0, ...rows.map(row => row.value));
  if (!rows.length || max <= 0) return <p className="text-ink-faint py-6 text-center text-[12.5px]">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map(row => {
        const grid = "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]";
        const body = <>
          <span className="min-w-0 truncate text-[12.5px]" title={row.label}>
            <span className={cn("text-ink", row.href && "group-hover:text-brand group-hover:underline")}>{row.label}</span>
            {row.note ? <span className="text-ink-faint block text-[11px]">{row.note}</span> : null}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className={cn("h-3 rounded-r-[2px]", row.swatch)} style={{ width: `${(row.value / max) * 100}%`, minWidth: row.value > 0 ? 2 : 0, maxWidth: "calc(100% - 5.5rem)" }} />
            <span className={cn("shrink-0 text-[12px] font-medium tabular-nums", row.tone === "critical" ? "text-critical" : row.tone === "faint" ? "text-ink-faint font-normal" : "text-ink")}>{row.display}</span>
          </span>
        </>;
        return <li key={row.key}>{row.href
          ? <Link href={row.href} className={cn(grid, "group hover:bg-surface-sunken -mx-1.5 rounded-sm px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 touch:min-h-11")}>{body}</Link>
          : <div className={grid}>{body}</div>}</li>;
      })}
    </ul>
  );
}

/** A headline figure: label, value, and one line of context. */
export function StatTile({ label, value, context, tone, href }: { label: string; value: string; context?: string; tone?: "critical"; href?: string }) {
  const body = (
    <>
      <span className="text-ink-faint block text-[11px] font-semibold tracking-[0.06em] uppercase">{label}</span>
      <span className={cn("mt-1 block truncate text-[18px] leading-tight font-semibold tracking-[-0.01em]", tone === "critical" ? "text-critical" : "text-ink")}>{value}</span>
      {context ? <span className="text-ink-muted mt-1 block truncate text-[11.5px]">{context}</span> : null}
    </>
  );
  const cell = "block min-w-0 px-4 py-3";
  return href ? <Link href={href} className={cn(cell, "hover:bg-surface-sunken focus-visible:ring-ring/40 outline-none focus-visible:ring-[3px]")}>{body}</Link> : <div className={cell}>{body}</div>;
}
