/**
 * How a company's documents look. A style holds the layout, the type and its
 * size, the paper, the colour, where the logo sits and how big, what the
 * documents show, and each kind's own title and terms. A company has a
 * default style and may keep others for particular customers (Xero calls
 * them branding themes).
 *
 * A style is kept as settings (document_styles.settings) and read here with
 * a default for anything not set, so a style saved before an option existed
 * still reads. Client-safe: the editor shows the same choices.
 */

export const STYLED_DOCUMENTS = [
  { key: "invoice", label: "Invoice" },
  { key: "quote", label: "Quote" },
  { key: "credit_note", label: "Credit note" },
  { key: "statement", label: "Statement" },
  { key: "remittance", label: "Remittance advice" },
] as const;
export type StyledDocument = (typeof STYLED_DOCUMENTS)[number]["key"];

export const LAYOUTS = [
  { key: "classic", label: "Classic", hint: "Title and total in the colour, shaded column heads" },
  { key: "modern", label: "Modern", hint: "A band of colour across the top, column heads in the colour" },
  { key: "plain", label: "Plain", hint: "Black on white with ruled lines: prints well on any printer" },
] as const;
export const FONTS = [
  { key: "sans", label: "Sans serif", hint: "Roboto" },
  { key: "serif", label: "Serif", hint: "Gentium" },
] as const;
export const SIZES = [
  { key: "small", label: "Small" },
  { key: "standard", label: "Standard" },
  { key: "large", label: "Large" },
] as const;
export const PAPERS = [
  { key: "A4", label: "A4" },
  { key: "LETTER", label: "US Letter" },
] as const;
export const LOGO_PLACES = [
  { key: "left", label: "Left" },
  { key: "centre", label: "Centre" },
  { key: "right", label: "Right" },
] as const;
export const LOGO_SIZES = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
] as const;

export const SWATCHES = ["#1d2433", "#0d6e6e", "#1f3a8a", "#6b21a8", "#7c4a2d", "#9a3412", "#166534", "#b91c1c"];

export type DocumentStyle = {
  layout: (typeof LAYOUTS)[number]["key"];
  font: (typeof FONTS)[number]["key"];
  size: (typeof SIZES)[number]["key"];
  paper: (typeof PAPERS)[number]["key"];
  /** Titles, rules and the total; the plain layout leaves it out. */
  accent: string;
  logoPlace: (typeof LOGO_PLACES)[number]["key"];
  logoSize: (typeof LOGO_SIZES)[number]["key"];
  /** Printed on headed paper: the company's own heading is left off, with room at the top for the paper's. */
  letterhead: boolean;
  /** The HE number and TIC beside the VAT number, which a VAT invoice always shows. */
  showRegistration: boolean;
  /** The company's email under its address. */
  showContact: boolean;
  /** Quantity and unit price: only when a line has them, or on every document. */
  itemColumns: "auto" | "always";
  /** Each line's VAT rate. The totals give the VAT at each rate either way. */
  showVatRate: boolean;
  /** How to pay: the bank account's details, on invoices and statements. */
  showPayment: boolean;
  /** A slip to cut off and send back with the payment, at the foot of invoices and statements. */
  paymentSlip: boolean;
  /** Each kind's title in English ("Tax invoice", "Estimate"). A document in Greek keeps its Greek title. */
  titles: Partial<Record<StyledDocument, string>>;
  /** The terms or message at the foot of each kind. */
  terms: Partial<Record<StyledDocument, string>>;
};

export const DEFAULT_STYLE: DocumentStyle = {
  layout: "classic", font: "sans", size: "standard", paper: "A4", accent: "#1d2433", logoPlace: "left", logoSize: "medium",
  letterhead: false, showRegistration: true, showContact: true, itemColumns: "auto", showVatRate: true, showPayment: true, paymentSlip: false,
  titles: {}, terms: {},
};

export const TITLE_MAX = 40;
export const TERMS_MAX = 1000;
const HEX = /^#[0-9a-f]{6}$/i;

const choose = <T extends string>(options: readonly { key: T }[], value: unknown, fallback: T): T => options.some(option => option.key === value) ? value as T : fallback;
const flag = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const texts = (value: unknown, max: number) => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(STYLED_DOCUMENTS.flatMap(({ key }) => {
    const text = typeof record[key] === "string" ? (record[key] as string).trim().slice(0, max) : "";
    return text ? [[key, text]] : [];
  })) as Partial<Record<StyledDocument, string>>;
};

/** A style as saved, every setting checked, with the default for anything missing or not understood. */
export function readStyle(settings: unknown): DocumentStyle {
  const value = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const d = DEFAULT_STYLE;
  return {
    layout: choose(LAYOUTS, value.layout, d.layout),
    font: choose(FONTS, value.font, d.font),
    size: choose(SIZES, value.size, d.size),
    paper: choose(PAPERS, value.paper, d.paper),
    accent: typeof value.accent === "string" && HEX.test(value.accent) ? value.accent.toLowerCase() : d.accent,
    logoPlace: choose(LOGO_PLACES, value.logoPlace, d.logoPlace),
    logoSize: choose(LOGO_SIZES, value.logoSize, d.logoSize),
    letterhead: flag(value.letterhead, d.letterhead),
    showRegistration: flag(value.showRegistration, d.showRegistration),
    showContact: flag(value.showContact, d.showContact),
    itemColumns: value.itemColumns === "always" ? "always" : "auto",
    showVatRate: flag(value.showVatRate, d.showVatRate),
    showPayment: flag(value.showPayment, d.showPayment),
    paymentSlip: flag(value.paymentSlip, d.paymentSlip),
    titles: texts(value.titles, TITLE_MAX),
    terms: texts(value.terms, TERMS_MAX),
  };
}

/** A style in a link, for the editor's preview: base64url of its settings. */
export function encodeStyle(style: DocumentStyle) {
  const bytes = new TextEncoder().encode(JSON.stringify(style));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeStyle(value: string | null) {
  if (!value || value.length > 8000) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return readStyle(JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))));
  } catch { return null; }
}

/** The text colour that reads on the accent: ink on a light colour, white on a dark one. */
export function onAccent(accent: string) {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(accent.slice(at, at + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1d2433" : "#ffffff";
}
