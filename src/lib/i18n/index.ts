/**
 * The languages Ledgerline's screens are read in: English, and Greek for
 * the client company's own people who would rather. Each person chooses
 * (app_users.locale); a practice and its clients may read the same page in
 * different languages. Client-safe.
 *
 * A screen's words are its English, looked up in the Greek dictionary (./el):
 * t("Invoices"), t("Search {name}, or jump to…", { name }), t.n(count,
 * "{count} company", "{count} companies"). Where the same English needs
 * different Greek, a context follows a bar and is never shown: t("Void|action")
 * is a button, Ακύρωση; t("Void") is a status, Ακυρωμένο. Words the dictionary lacks stay in English,
 * and scripts/check-greek.mts lists any a translated screen still lacks.
 * Figures and dates come in the same language (lib/format's makeFormat).
 *
 * A server component takes its own with `await getI18n()` (./server); a
 * client component with `useI18n()` (components/common/locale).
 */

import { formatIn, type Format, type FormatLocale } from "@/lib/format";
import { GREEK } from "./el";

export const LOCALES = ["en", "el"] as const satisfies readonly FormatLocale[];
export type Locale = (typeof LOCALES)[number];
/** Each language in its own words, as the choice between them reads. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", el: "Ελληνικά" };
export const isLocale = (value: unknown): value is Locale => value === "en" || value === "el";

export type Vars = Record<string, string | number | null | undefined>;
/**
 * `n`: a count's words, singular or plural (Greek's are chosen the same way).
 * `also`: the words a search finds something by, with their Greek as well on
 * a Greek screen, so that either language finds it. `has`: whether the
 * dictionary knows these words. `message`: a message the server wrote in
 * English with values in it ("Line 2 needs an amount."), read against the
 * dictionary's phrases with {names}; for problems and notices only, never
 * for a name or a description, which a phrase could happen to match.
 */
export type Translate = {
  (text: string, vars?: Vars): string;
  n: (count: number, one: string, other: string, vars?: Vars) => string;
  also: (words: string) => string;
  has: (text: string) => boolean;
  message: (text: string) => string;
};
export type I18n = Format & { locale: Locale; t: Translate };

const DICTIONARY = new Map(Object.entries(GREEK));

/** The English itself: what is before a context's bar. */
const bare = (text: string) => text.replace(/\|[\w ]+$/, "");
/** `{name}` in a phrase, filled in. A value left out leaves its braces, so a slip shows. */
const fill = (text: string, vars?: Vars) => vars ? text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] === null || vars[key] === undefined ? whole : String(vars[key])) : text;

/** Each phrase with {names} as a pattern that finds the values in a message: "{label} is required." finds "Invoice number". */
let patterns: { pattern: RegExp; greek: string }[] | null = null;
// The phrase with the most words of its own is tried first, so "{name} owes {amount} by {date}." wins over "{name} owes {amount}.".
const templates = () => patterns ??= [...DICTIONARY].filter(([english]) => english.includes("{"))
  .sort(([a], [b]) => b.replace(/\{\w+\}/g, "").length - a.replace(/\{\w+\}/g, "").length)
  .flatMap(([english, greek]) => {
    try { return [{ pattern: new RegExp(`^${english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\w+)\\\}/g, "(?<$1>.+?)")}$`), greek }]; }
    catch { return []; }
  });

function translator(locale: Locale): Translate {
  const words = locale === "el" ? DICTIONARY : null;
  const t = ((text: string, vars?: Vars) => fill(words?.get(text) ?? bare(text), vars)) as Translate;
  t.n = (count, one, other, vars) => t(count === 1 ? one : other, { count, ...vars });
  t.also = text => words?.has(text) ? `${text} ${words.get(text)}` : text;
  t.has = text => !words || words.has(text);
  t.message = text => {
    if (!words || words.has(text)) return t(text);
    for (const { pattern, greek } of templates()) {
      const found = pattern.exec(text)?.groups;
      // The values are words too: "Invoice number" is "Αριθμός τιμολογίου".
      if (found) return fill(greek, Object.fromEntries(Object.entries(found).map(([name, value]) => [name, words.get(value) ?? value])));
    }
    return text;
  };
  return t;
}

const KITS: Record<Locale, I18n> = {
  en: { locale: "en", t: translator("en"), ...formatIn("en") },
  el: { locale: "el", t: translator("el"), ...formatIn("el") },
};

/** One language's words and formats. */
export const i18nFor = (locale: Locale): I18n => KITS[locale];
