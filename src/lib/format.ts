/**
 * Formatting helpers.
 *
 * Locale and time zone are pinned rather than taken from the runtime. The firm
 * operates from Nicosia, the whole team reads the same numbers, and a floating
 * locale would make the server and the browser disagree during hydration.
 * Someone who reads Ledgerline in Greek gets Greek figures and dates, chosen
 * by them, not by their browser (makeFormat below).
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

/** The languages Ledgerline's screens can be read in: their words (lib/i18n) and, here, their figures and dates. */
export type FormatLocale = "en" | "el";
const INTL: Record<FormatLocale, string> = { en: FIRM_LOCALE, el: "el-GR" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Every formatter, in one language: `€1,323.40` and `28 Aug 2026` in
 * English, `1.323,40 €` and `28 Αυγ 2026` in Greek, with a 24-hour clock in
 * both. The functions this module exports are the English ones; a screen
 * read in Greek takes its own from lib/i18n (getI18n on the server, useI18n
 * in the browser), so the same page reads alike on both sides.
 */
function makeFormat(locale: FormatLocale) {
  const intl = INTL[locale];
  const el = locale === "el";
  const currencyFormatters = new Map<string, Intl.NumberFormat>();
  const exactFormatters = new Map<string, Intl.NumberFormat>();

  function currencyFormatter(currency: string, compact: boolean) {
    const key = `${currency}:${compact}`;
    let formatter = currencyFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(intl, {
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
  function formatMoney(
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

  /**
   * `€1,323.40`. An invoice figure is the figure on the document, so the cents
   * stay. Accepts the numeric strings PostgREST returns for `numeric` columns.
   */
  function formatAmount(amount: number | string | null | undefined, currency = requestCurrency(), fallback = "—") {
    if (amount === null || amount === undefined || amount === "") return fallback;
    const value = Number(amount);
    if (!Number.isFinite(value)) return fallback;
    // Less than half a cent either way is nothing: never "-€0.00".
    const shown = Math.abs(value) < 0.005 ? 0 : value;
    let formatter = exactFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat(intl, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
      exactFormatters.set(currency, formatter);
    }
    return formatter.format(shown);
  }

  function formatNumber(value: number | null | undefined) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return new Intl.NumberFormat(intl).format(value);
  }

  /** "Good morning", "Good afternoon" or "Good evening", by the hour in Cyprus. In Greek, Καλημέρα until noon and Καλησπέρα after. */
  function greeting(now = new Date()) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: FIRM_TIME_ZONE }).format(now));
    if (el) return hour < 12 ? "Καλημέρα" : "Καλησπέρα";
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }

  /** `28 Aug 2026` */
  function formatDate(value: string | Date | null | undefined) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(intl, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: FIRM_TIME_ZONE,
    }).format(new Date(value));
  }

  /** `28 Aug, 14:30` */
  function formatDateTime(value: string | Date | null | undefined) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(intl, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: FIRM_TIME_ZONE,
    }).format(new Date(value));
  }

  /** `14:30` */
  function formatTime(value: string | Date | null | undefined) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(intl, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: FIRM_TIME_ZONE,
    }).format(new Date(value));
  }

  /**
   * Short, scannable relative time: `now`, `12m`, `4h`, `3d`, `2w`, then a date.
   * Past and future both read naturally in a feed or a due column.
   */
  function formatRelative(
    value: string | Date | null | undefined,
    now: Date = new Date(),
  ) {
    if (!value) return "—";
    const then = new Date(value).getTime();
    const delta = now.getTime() - then;
    const magnitude = Math.abs(delta);
    // In Greek: "12 λ.", "4 ώ.", "3 ημ.", "2 εβδ.", and "σε 3 ημ." ahead.
    const say = (count: number, short: string, greek: string) => el ? `${delta >= 0 ? "" : "σε "}${count} ${greek}` : `${count}${short}${delta >= 0 ? "" : " ahead"}`;

    if (magnitude < MINUTE) return el ? "μόλις τώρα" : "just now";
    if (magnitude < HOUR) return say(Math.round(magnitude / MINUTE), "m", "λ.");
    if (magnitude < DAY) return say(Math.round(magnitude / HOUR), "h", "ώ.");
    if (magnitude < 7 * DAY) return say(Math.round(magnitude / DAY), "d", "ημ.");
    if (magnitude < 28 * DAY) return say(Math.round(magnitude / (7 * DAY)), "w", "εβδ.");
    return formatDate(value);
  }

  /** The same, for a sentence: "just now", "5 minutes ago", "yesterday", "2 weeks ago", then the date. */
  function formatAgo(value: string | Date | null | undefined, now: Date = new Date()) {
    if (!value) return "—";
    const delta = now.getTime() - new Date(value).getTime();
    if (delta < 0 || delta >= 28 * DAY) return el ? `στις ${formatDate(value)}` : `on ${formatDate(value)}`;
    const count = (unit: number, name: string) => { const n = Math.max(1, Math.round(delta / unit)); return `${n === 1 ? (name === "hour" ? "an" : "a") : n} ${name}${n === 1 ? "" : "s"} ago`; };
    // πριν από ένα λεπτό, πριν από 5 λεπτά; μία ώρα, μία εβδομάδα.
    const greek = (unit: number, one: string, many: string) => { const n = Math.max(1, Math.round(delta / unit)); return `πριν από ${n === 1 ? one : `${n} ${many}`}`; };
    if (delta < MINUTE) return el ? "μόλις τώρα" : "just now";
    if (delta < HOUR) return el ? greek(MINUTE, "ένα λεπτό", "λεπτά") : count(MINUTE, "minute");
    if (delta < DAY) return el ? greek(HOUR, "μία ώρα", "ώρες") : count(HOUR, "hour");
    if (delta < 2 * DAY) return el ? "χθες" : "yesterday";
    if (delta < 7 * DAY) return el ? greek(DAY, "μία ημέρα", "ημέρες") : count(DAY, "day");
    return el ? greek(7 * DAY, "μία εβδομάδα", "εβδομάδες") : count(7 * DAY, "week");
  }

  /**
   * How overdue something is, phrased for a person chasing it.
   * Returns null when the moment has not passed yet.
   */
  function overdueBy(
    value: string | Date | null | undefined,
    now: Date = new Date(),
  ) {
    if (!value) return null;
    const delta = now.getTime() - new Date(value).getTime();
    if (delta <= 0) return null;
    if (delta < HOUR) { const minutes = Math.max(1, Math.round(delta / MINUTE)); return el ? `${minutes} λεπτ${minutes === 1 ? "ό" : "ά"} καθυστέρηση` : `${minutes} min overdue`; }
    if (delta < DAY) { const hours = Math.round(delta / HOUR); return el ? `${hours} ώρ${hours === 1 ? "α" : "ες"} καθυστέρηση` : `${hours} hr overdue`; }
    const days = Math.round(delta / DAY);
    return el ? `${days} ημέρ${days === 1 ? "α" : "ες"} καθυστέρηση` : `${days} day${days === 1 ? "" : "s"} overdue`;
  }

  /** Calendar-day label used to group a chronological feed. */
  function dayLabel(value: string | Date, now: Date = new Date()) {
    const date = new Date(value);
    const dayKey = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: FIRM_TIME_ZONE,
      }).format(d);

    const yesterday = new Date(now.getTime() - DAY);
    if (dayKey(date) === dayKey(now)) return el ? "Σήμερα" : "Today";
    if (dayKey(date) === dayKey(yesterday)) return el ? "Χθες" : "Yesterday";
    return new Intl.DateTimeFormat(intl, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: FIRM_TIME_ZONE,
    }).format(date);
  }

  return { formatMoney, formatAmount, formatNumber, greeting, formatDate, formatDateTime, formatTime, formatRelative, formatAgo, overdueBy, dayLabel };
}

export type Format = ReturnType<typeof makeFormat>;
const FORMATS: Record<FormatLocale, Format> = { en: makeFormat("en"), el: makeFormat("el") };
/** The formatters of one language. */
export const formatIn = (locale: FormatLocale) => FORMATS[locale];
export const { formatMoney, formatAmount, formatNumber, greeting, formatDate, formatDateTime, formatTime, formatRelative, formatAgo, overdueBy, dayLabel } = FORMATS.en;

export function initialsFromName(name: string | null | undefined) {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The name to greet someone by: "Dr Maria Kyriacou" is Maria, as "Maria Kyriacou" is. */
export function firstName(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 && /^(dr|mr|mrs|ms|miss|prof|professor)\.?$/i.test(parts[0]) ? parts[1] : parts[0]) ?? "";
}
