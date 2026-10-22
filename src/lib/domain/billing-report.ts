const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** The calendar months ending with today's, oldest first. */
export function reportMonths(today: string, count: number) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return { key: date.toISOString().slice(0, 7), label: MONTH_SHORT.format(date), title: MONTH_LONG.format(date) };
  });
}

/** Round steps for a chart's axis, from nothing to at least `max`. */
export function axisTicks(max: number, { whole = false }: { whole?: boolean } = {}): number[] {
  if (max <= 0) return [0];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const found = [1, 2, 2.5, 5, 10].map(multiple => multiple * magnitude).find(candidate => candidate >= rough) ?? 10 * magnitude;
  const step = whole ? Math.max(1, Math.ceil(found)) : found;
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
