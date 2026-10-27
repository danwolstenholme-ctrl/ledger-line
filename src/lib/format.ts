/**
 * Formatting helpers.
 *
 * Locale and time zone are pinned rather than taken from the runtime. The firm
 * operates from Nicosia, the whole team reads the same numbers, and a floating
 * locale would make the server and the browser disagree during hydration.
 */

import { cache } from "react";

export const FIRM_LOCALE = "en-GB";
export const FIRM_TIME_ZONE = "Europe/Nicosia";

/**
 * The currency a server request's figures are in: that of the company the
 * request is about, which requireOrg() sets as it loads it, so a page's
 * amounts need not each name it. One value per request (React's cache). In
 * the browser, and on a page about many companies, an amount names its own:
 * useCurrency() inside a company, or each row's.
 */
const requestMoney = cache(() => ({ currency: "EUR" }));
export function setRequestCurrency(currency: string) { requestMoney().currency = currency; }
export const requestCurrency = () => requestMoney().currency;

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, compact: boolean) {
  const key = `${currency}:${compact}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(FIRM_LOCALE, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

/** `€12,500`. Fees are quoted in whole units; the cents are noise on a KPI. */
export function formatMoney(
  amount: number | null | undefined,
  currency = requestCurrency(),
  options: { compact?: boolean; fallback?: string } = {},
) {
  const { compact = false, fallback = "—" } = options;
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return fallback;
  }
  return currencyFormatter(currency, compact).format(Math.abs(amount) < 0.5 ? 0 : amount);
}

const exactFormatters = new Map<string, Intl.NumberFormat>();

/**
 * `€1,323.40`. An invoice figure is the figure on the document, so the cents
 * stay. Accepts the numeric strings PostgREST returns for `numeric` columns.
 */
export function formatAmount(amount: number | string | null | undefined, currency = requestCurrency(), fallback = "—") {
  if (amount === null || amount === undefined || amount === "") return fallback;
  const value = Number(amount);
  if (!Number.isFinite(value)) return fallback;
  // Less than half a cent either way is nothing: never "-€0.00".
  const shown = Math.abs(value) < 0.005 ? 0 : value;
  let formatter = exactFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(FIRM_LOCALE, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    exactFormatters.set(currency, formatter);
  }
  return formatter.format(shown);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(FIRM_LOCALE).format(value);
}

/** "Good morning", "Good afternoon" or "Good evening", by the hour in Cyprus. */
export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: FIRM_TIME_ZONE }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** `28 Aug 2026` */
export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(FIRM_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: FIRM_TIME_ZONE,
  }).format(new Date(value));
}

/** `28 Aug, 14:30` */
export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(FIRM_LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FIRM_TIME_ZONE,
  }).format(new Date(value));
}

/** `14:30` */
export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(FIRM_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FIRM_TIME_ZONE,
  }).format(new Date(value));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Short, scannable relative time: `now`, `12m`, `4h`, `3d`, `2w`, then a date.
 * Past and future both read naturally in a feed or a due column.
 */
export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date(),
) {
  if (!value) return "—";
  const then = new Date(value).getTime();
  const delta = now.getTime() - then;
  const magnitude = Math.abs(delta);
  const suffix = delta >= 0 ? "" : " ahead";

  if (magnitude < MINUTE) return "just now";
  if (magnitude < HOUR) return `${Math.round(magnitude / MINUTE)}m${suffix}`;
  if (magnitude < DAY) return `${Math.round(magnitude / HOUR)}h${suffix}`;
  if (magnitude < 7 * DAY) return `${Math.round(magnitude / DAY)}d${suffix}`;
  if (magnitude < 28 * DAY) {
    return `${Math.round(magnitude / (7 * DAY))}w${suffix}`;
  }
  return formatDate(value);
}

/** The same, for a sentence: "just now", "5 minutes ago", "yesterday", "2 weeks ago", then the date. */
export function formatAgo(value: string | Date | null | undefined, now: Date = new Date()) {
  if (!value) return "—";
  const delta = now.getTime() - new Date(value).getTime();
  if (delta < 0 || delta >= 28 * DAY) return `on ${formatDate(value)}`;
  const count = (unit: number, name: string) => { const n = Math.max(1, Math.round(delta / unit)); return `${n === 1 ? (name === "hour" ? "an" : "a") : n} ${name}${n === 1 ? "" : "s"} ago`; };
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return count(MINUTE, "minute");
  if (delta < DAY) return count(HOUR, "hour");
  if (delta < 2 * DAY) return "yesterday";
  if (delta < 7 * DAY) return count(DAY, "day");
  return count(7 * DAY, "week");
}

/**
 * How overdue something is, phrased for a person chasing it.
 * Returns null when the moment has not passed yet.
 */
export function overdueBy(
  value: string | Date | null | undefined,
  now: Date = new Date(),
) {
  if (!value) return null;
  const delta = now.getTime() - new Date(value).getTime();
  if (delta <= 0) return null;
  if (delta < HOUR) return `${Math.max(1, Math.round(delta / MINUTE))} min overdue`;
  if (delta < DAY) return `${Math.round(delta / HOUR)} hr overdue`;
  const days = Math.round(delta / DAY);
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

/** Calendar-day label used to group a chronological feed. */
export function dayLabel(value: string | Date, now: Date = new Date()) {
  const date = new Date(value);
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: FIRM_TIME_ZONE,
    }).format(d);

  const yesterday = new Date(now.getTime() - DAY);
  if (dayKey(date) === dayKey(now)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(FIRM_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: FIRM_TIME_ZONE,
  }).format(date);
}

export function initialsFromName(name: string | null | undefined) {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
