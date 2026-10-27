"use client";

import { createContext, use, useEffect, type ReactNode } from "react";

import { i18nFor, type Locale, type Vars } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");

/** The language of the person signed in, for every client component beneath (app)/layout. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // The page says which language it is in, so a screen reader reads Greek as Greek.
  useEffect(() => {
    document.documentElement.lang = locale === "el" ? "el" : "en-GB";
    return () => { document.documentElement.lang = "en-GB"; };
  }, [locale]);
  // Said on the page as well, so that capitals drop Greek's accents from the first paint (ΣΤΗΝ ΤΡΑΠΕΖΑ, not ΣΤΗΝ ΤΡΆΠΕΖΑ).
  return <LocaleContext value={locale}><div lang={locale === "el" ? "el" : undefined} className="contents">{children}</div></LocaleContext>;
}

/** A client component's words, figures and dates: `const { t, formatAmount } = useI18n()`. */
export function useI18n() {
  return i18nFor(use(LocaleContext));
}

/** A phrase in the reader's language, for a module shared by server and client components that cannot ask for it itself: <T text="Not recorded" />. */
export function T({ text, vars }: { text: string; vars?: Vars }) {
  return useI18n().t(text, vars);
}
