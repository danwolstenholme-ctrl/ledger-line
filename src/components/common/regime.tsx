"use client";

import { createContext, useContext, type ReactNode } from "react";

import { regimeOf } from "@/lib/domain/regimes";

type RegimeValue = { country: string; currency: string; vatRates: readonly number[] };
const RegimeContext = createContext<RegimeValue>({ country: "CY", currency: "EUR", vatRates: regimeOf("CY").vatRates });

/** The company's country, currency and VAT rates, for the figures and forms inside its books. Outside a company, Cyprus and the euro. */
export function RegimeProvider({ country, children }: { country: string; children: ReactNode }) {
  const profile = regimeOf(country);
  return <RegimeContext value={{ country: profile.code, currency: profile.currency, vatRates: profile.vatRates }}>{children}</RegimeContext>;
}

export const useRegime = () => useContext(RegimeContext);
export const useCurrency = () => useContext(RegimeContext).currency;
/** The company's currency sign, for a column heading: €, £. */
export function useCurrencySymbol() {
  const currency = useCurrency();
  return ({ EUR: "€", GBP: "£" } as Record<string, string>)[currency] ?? currency;
}
