/**
 * The countries Ledgerline keeps books for, and what differs between them:
 * the currency, the VAT rates and how documents name them, the registers and
 * the tax authority, and the tax year an individual pays tax by. Each
 * organisation has one country; its tax regime comes from here, not from the
 * install. Client-safe.
 *
 * United Kingdom, checked on GOV.UK on 27 Oct 2026: VAT at 20%, 5% and 0%;
 * a VAT return and its payment due 1 calendar month and 7 days after the
 * period; an individual's tax year from 6 April to 5 April.
 */

export const REGIME_CODES = ["CY", "GB"] as const;
export type Regime = (typeof REGIME_CODES)[number];

export type RegimeProfile = {
  code: Regime; name: string; currency: "EUR" | "GBP"; currencyName: string;
  /** Every VAT rate the country uses, highest first; the first is the standard rate. */
  vatRates: readonly number[];
  taxAuthority: string; registrar: string;
  labels: { registration: string; taxId: string; vatNumber: string };
  /** What a VAT number looks like, for the hint beside the field. */
  vatNumberExample: string;
  /** How a sale's VAT treatment reads in this country. */
  treatments: Record<"standard" | "exempt" | "reverse_charge" | "outside_scope", string>;
  /** What an invoice says when the customer accounts for the VAT. */
  reverseChargeNote: string;
};

export const REGIMES: Record<Regime, RegimeProfile> = {
  CY: {
    code: "CY", name: "Cyprus", currency: "EUR", currencyName: "euro", vatRates: [19, 9, 5, 3, 0],
    taxAuthority: "the Tax Department", registrar: "the Registrar of Companies",
    labels: { registration: "Registration (HE)", taxId: "Tax identification (TIC)", vatNumber: "VAT number" },
    vatNumberExample: "CY10412907G",
    treatments: { standard: "Standard (19%, 9%, 5%, 3% or 0% by line)", exempt: "Exempt", reverse_charge: "Reverse charge (EU business customer)", outside_scope: "Outside the scope of Cyprus VAT" },
    reverseChargeNote: "Reverse charge: the customer accounts for the VAT (Article 196, Directive 2006/112/EC).",
  },
  GB: {
    code: "GB", name: "United Kingdom", currency: "GBP", currencyName: "pound sterling", vatRates: [20, 5, 0],
    taxAuthority: "HMRC", registrar: "Companies House",
    labels: { registration: "Company number", taxId: "Unique Taxpayer Reference (UTR)", vatNumber: "VAT registration number" },
    vatNumberExample: "GB123456782",
    treatments: { standard: "Standard (20%, 5% or 0% by line)", exempt: "Exempt", reverse_charge: "Domestic reverse charge (construction, CIS)", outside_scope: "Outside the scope of UK VAT" },
    reverseChargeNote: "Reverse charge: customer to pay the VAT to HMRC.",
  },
};

export const regimeOf = (code: string | null | undefined): RegimeProfile => REGIMES[(code ?? "CY") as Regime] ?? REGIMES.CY;
export const standardRate = (code: string | null | undefined) => regimeOf(code).vatRates[0];

/**
 * An individual's tax year containing `date`: in the UK, 6 April to
 * 5 April; in Cyprus, the calendar year. Named by its years: "2026 to 2027".
 */
export function individualTaxYear(code: string | null | undefined, date: string) {
  const year = Number(date.slice(0, 4));
  if (regimeOf(code).code === "GB") {
    const start = date >= `${year}-04-06` ? year : year - 1;
    return { from: `${start}-04-06`, to: `${start + 1}-04-05`, label: `${start} to ${start + 1}` };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
}

/** The purchase-side reverse charges a UK return separates: services from abroad (boxes 1, 4, 6 and 7), construction under CIS (1, 4 and 7), and imports under postponed VAT accounting (1, 4 and 7). */
export const REVERSE_CHARGE_KINDS = { services: "Services bought from abroad", construction: "Construction services (CIS domestic reverse charge)", import: "Imported goods (postponed VAT accounting)" } as const;
export type ReverseChargeKind = keyof typeof REVERSE_CHARGE_KINDS;
