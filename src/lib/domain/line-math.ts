/**
 * The arithmetic of a sold line, done in whole numbers so the screen, the
 * server and the database agree to the cent: quantity to three places, unit
 * price to four, discount to two, rounded half up as Postgres rounds numeric.
 * Client-safe.
 */

const SCALE = { quantity: 3, price: 4, discount: 2 } as const;
// BigInt(…) rather than literals: the build targets ES2017.
const ZERO = BigInt(0), TWO = BigInt(2), FIVE = BigInt(5), TEN = BigInt(10), HUNDRED = BigInt(100), WHOLE = BigInt(10000), CENTS = BigInt(1_000_000_000);

/** A decimal written by a person, as an integer at `places` decimal places; null when it is not a number. */
export function scaled(value: string | number | null | undefined, places: number): bigint | null {
  const text = String(value ?? "").replace(/[,\s€]/g, "").trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === "" || text === ".") return null;
  const [whole, fraction = ""] = text.split(".");
  const digits = (fraction + "0".repeat(places + 1)).slice(0, places + 1);
  const raw = BigInt(`${whole || "0"}${digits}`);
  return (raw + FIVE) / TEN;
}

const roundDiv = (numerator: bigint, divisor: bigint) => (numerator + divisor / TWO) / divisor;

export type LineInput = { quantity: string | number; unit_price: string | number; discount_pct?: string | number | null; vat_rate: number };

/** The line's net and VAT in cents, or null when a figure cannot be read. */
export function lineCents(line: LineInput): { net: number; vat: number } | null {
  const quantity = scaled(line.quantity, SCALE.quantity), price = scaled(line.unit_price, SCALE.price);
  const discount = line.discount_pct === "" || line.discount_pct == null ? ZERO : scaled(line.discount_pct, SCALE.discount);
  if (quantity === null || price === null || discount === null || quantity <= ZERO || discount >= WHOLE) return null;
  // quantity/1e3 × price/1e4 × (1e4 − discount)/1e4 euros, in cents: divide by 1e9.
  const net = roundDiv(quantity * price * (WHOLE - discount), CENTS);
  const vat = roundDiv(net * BigInt(Math.round(line.vat_rate)), HUNDRED);
  return { net: Number(net), vat: Number(vat) };
}

/** The figures as the database stores them, rounded to their columns. */
export function normalisedLine(line: LineInput) {
  const quantity = scaled(line.quantity, SCALE.quantity), price = scaled(line.unit_price, SCALE.price);
  const discount = line.discount_pct === "" || line.discount_pct == null ? ZERO : scaled(line.discount_pct, SCALE.discount);
  if (quantity === null || price === null || discount === null) return null;
  return { quantity: Number(quantity) / 1000, unit_price: Number(price) / 10000, discount_pct: Number(discount) / 100 };
}

/** 20, 1.5, 0.25: a quantity without trailing zeros. */
export function formatQuantity(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-GB", { maximumFractionDigits: 3 }) : String(value);
}

/** A unit price to the cent, or to four places when it has them. */
export function formatUnitPrice(value: number | string, currency = "EUR") {
  const number = Number(value);
  const places = Math.round(number * 100) === number * 100 ? 2 : 4;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: places }).format(number);
}

/** A price as it goes in an input: 18.5 → "18.50", 0.0350 → "0.035". */
export function priceInput(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Math.round(number * 100) === number * 100 ? number.toFixed(2) : String(Number(number.toFixed(4)));
}
