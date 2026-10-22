/**
 * EU VAT numbers, without a network: which country, whether it has that
 * country's shape, and, where the country publishes one, whether its check
 * digit agrees. Catches a mistyped digit before anything is invoiced on it;
 * VIES (lib/vies) then says whether the number is registered. Client-safe.
 *
 * Country codes are VIES's: EL for Greece (GR is accepted and read as EL), XI
 * for Northern Ireland.
 */

export const VIES_COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", CY: "Cyprus", CZ: "Czechia", DE: "Germany", DK: "Denmark", EE: "Estonia", EL: "Greece",
  ES: "Spain", FI: "Finland", FR: "France", HR: "Croatia", HU: "Hungary", IE: "Ireland", IT: "Italy", LT: "Lithuania", LU: "Luxembourg",
  LV: "Latvia", MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania", SE: "Sweden", SI: "Slovenia", SK: "Slovakia",
  XI: "Northern Ireland",
};

/** Each country's shape, after its two-letter prefix, and what to tell someone whose number does not fit it. */
const SHAPES: Record<string, [RegExp, string]> = {
  AT: [/^U\d{8}$/, "U and 8 digits"], BE: [/^[01]\d{9}$/, "10 digits, starting 0 or 1"], BG: [/^\d{9,10}$/, "9 or 10 digits"],
  CY: [/^[013459]\d{7}[A-Z]$/, "8 digits and a letter"], CZ: [/^\d{8,10}$/, "8 to 10 digits"], DE: [/^\d{9}$/, "9 digits"],
  DK: [/^\d{8}$/, "8 digits"], EE: [/^10\d{7}$/, "9 digits, starting 10"], EL: [/^\d{9}$/, "9 digits"],
  ES: [/^[A-Z0-9]\d{7}[A-Z0-9]$/, "9 characters: a letter or digit, 7 digits, a letter or digit"], FI: [/^\d{8}$/, "8 digits"],
  FR: [/^[A-HJ-NP-Z0-9]{2}\d{9}$/, "2 characters and 9 digits"], HR: [/^\d{11}$/, "11 digits"], HU: [/^\d{8}$/, "8 digits"],
  IE: [/^(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/, "7 digits and one or two letters"], IT: [/^\d{11}$/, "11 digits"],
  LT: [/^(\d{9}|\d{12})$/, "9 or 12 digits"], LU: [/^\d{8}$/, "8 digits"], LV: [/^\d{11}$/, "11 digits"], MT: [/^\d{8}$/, "8 digits"],
  NL: [/^\d{9}B\d{2}$/, "9 digits, B and 2 digits"], PL: [/^\d{10}$/, "10 digits"], PT: [/^\d{9}$/, "9 digits"], RO: [/^\d{2,10}$/, "2 to 10 digits"],
  SE: [/^\d{10}01$/, "12 digits, ending 01"], SI: [/^\d{8}$/, "8 digits"], SK: [/^\d{10}$/, "10 digits"], XI: [/^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, "9 or 12 digits"],
};

const digits = (value: string) => [...value].map(Number);
const weighted = (values: number[], weights: number[]) => weights.reduce((sum, weight, index) => sum + weight * values[index], 0);
const luhn = (value: string) => {
  let sum = 0;
  [...value].reverse().forEach((char, index) => { let digit = Number(char); if (index % 2) { digit *= 2; if (digit > 9) digit -= 9; } sum += digit; });
  return sum % 10 === 0;
};
/** ISO 7064 MOD 11,10, as Germany and Croatia use it. */
const mod11_10 = (value: string) => {
  let product = 10;
  for (const digit of digits(value.slice(0, -1))) { let sum = (digit + product) % 10; if (sum === 0) sum = 10; product = (2 * sum) % 11; }
  return (11 - product) % 10 === Number(value.at(-1));
};

/** The check each country publishes. A country without one here is checked for shape only. */
const CHECKS: Record<string, (number: string) => boolean> = {
  AT: number => {
    const d = digits(number.slice(1));
    const sum = d.slice(0, 7).reduce((total, digit, index) => total + (index % 2 ? Math.floor(digit * 2 / 10) + (digit * 2) % 10 : digit), 0);
    return (10 - ((sum + 4) % 10)) % 10 === d[7];
  },
  BE: number => (Number(number.slice(0, 8)) + Number(number.slice(8))) % 97 === 0,
  CY: number => {
    const map = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];
    const sum = digits(number.slice(0, 8)).reduce((total, digit, index) => total + (index % 2 ? digit : map[digit]), 0);
    return String.fromCharCode(65 + (sum % 26)) === number[8];
  },
  DE: mod11_10,
  DK: number => weighted(digits(number), [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0,
  EE: number => (10 - (weighted(digits(number), [3, 7, 1, 3, 7, 1, 3, 7]) % 10)) % 10 === Number(number[8]),
  EL: number => (weighted(digits(number), [256, 128, 64, 32, 16, 8, 4, 2]) % 11) % 10 === Number(number[8]),
  FI: number => { const r = weighted(digits(number), [7, 9, 10, 5, 8, 4, 2]) % 11; return r !== 1 && (r === 0 ? 0 : 11 - r) === Number(number[7]); },
  // The key protects the SIREN, which is itself Luhn-valid (La Poste's 356000000 being the one exception).
  FR: number => (luhn(number.slice(2)) || number.slice(2) === "356000000") && (!/^\d{2}/.test(number) || Number(number.slice(0, 2)) === (12 + 3 * (Number(number.slice(2)) % 97)) % 97),
  HR: mod11_10,
  HU: number => (10 - (weighted(digits(number), [9, 7, 3, 1, 9, 7, 3]) % 10)) % 10 === Number(number[7]),
  IE: number => {
    if (!/^\d{7}[A-W][A-IW]?$/.test(number)) return true;
    const sum = weighted(digits(number.slice(0, 7)), [8, 7, 6, 5, 4, 3, 2]) + (number[8] && number[8] !== "W" ? (number.charCodeAt(8) - 64) * 9 : 0);
    return "WABCDEFGHIJKLMNOPQRSTUV"[sum % 23] === number[7];
  },
  IT: number => luhn(number) && !/^0{7}/.test(number),
  LU: number => Number(number.slice(0, 6)) % 89 === Number(number.slice(6)),
  MT: number => weighted(digits(number), [3, 4, 6, 7, 8, 9, 10, 1]) % 37 === 0,
  NL: number => {
    const elevenProof = (() => { const sum = weighted(digits(number.slice(0, 8)), [9, 8, 7, 6, 5, 4, 3, 2]) % 11; return sum !== 10 && sum === Number(number[8]); })();
    // Since 2020, sole traders' numbers are checked with mod 97 over the whole number, letters as 10 upward.
    const mod97 = (() => { const text = [..."NL" + number].map(char => /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)).join(""); return BigInt(text) % BigInt(97) === BigInt(1); })();
    return elevenProof || mod97;
  },
  PL: number => { const r = weighted(digits(number), [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11; return r !== 10 && r === Number(number[9]); },
  PT: number => { const r = 11 - (weighted(digits(number), [9, 8, 7, 6, 5, 4, 3, 2]) % 11); return (r >= 10 ? 0 : r) === Number(number[8]); },
  RO: number => {
    const d = digits(number.padStart(10, "0"));
    return ((weighted(d, [7, 5, 3, 2, 1, 7, 5, 3, 2]) * 10) % 11) % 10 === d[9];
  },
  SE: number => luhn(number.slice(0, 10)),
  SI: number => { const r = 11 - (weighted(digits(number), [8, 7, 6, 5, 4, 3, 2]) % 11); return r !== 11 && (r === 10 ? 0 : r) === Number(number[7]); },
  // Divisible by 11. A company's third digit is 2, 3, 4, 7, 8 or 9, but personal numbers are also used, so that is left to VIES.
  SK: number => BigInt(number) % BigInt(11) === BigInt(0),
};

export type VatNumberCheck =
  | { ok: true; country: string; number: string; display: string; countryName: string; checked: boolean }
  | { ok: false; country: string | null; number: string; problem: string };

/** "de 298 765 431", "EL-094259216", "GR094259216": the country and the number, cleaned. */
export function splitVatNumber(input: string): { country: string | null; number: string } {
  const clean = input.toUpperCase().replace(/[\s.\-/]/g, "");
  const prefix = clean.slice(0, 2);
  if (/^[A-Z]{2}$/.test(prefix)) {
    const country = prefix === "GR" ? "EL" : prefix;
    if (VIES_COUNTRIES[country]) return { country, number: clean.slice(2) };
  }
  return { country: null, number: clean };
}

/** Whether a number could be an EU VAT number: its country, its shape, and its check digit where there is one. */
export function checkVatNumber(input: string, fallbackCountry?: string | null): VatNumberCheck {
  const split = splitVatNumber(input);
  const country = split.country ?? (fallbackCountry ? (fallbackCountry === "GR" ? "EL" : fallbackCountry) : null);
  const number = split.number;
  if (!number) return { ok: false, country, number, problem: "Write the VAT number, with or without its country prefix." };
  if (!country || !VIES_COUNTRIES[country]) return { ok: false, country, number, problem: "Start it with the country’s two letters, such as DE or FR: VIES checks EU VAT numbers only." };
  const [shape, described] = SHAPES[country];
  if (!shape.test(number)) return { ok: false, country, number, problem: `A ${VIES_COUNTRIES[country]} VAT number is ${country} followed by ${described}.` };
  const check = CHECKS[country];
  if (check && !check(number)) return { ok: false, country, number, problem: `The check ${/[A-Z]$/.test(number) && country !== "NL" ? "letter" : "digit"} of this ${VIES_COUNTRIES[country]} number doesn’t match: a character is probably mistyped.` };
  return { ok: true, country, number, display: `${country}${number}`, countryName: VIES_COUNTRIES[country], checked: Boolean(check) };
}

/**
 * For a VAT number being saved on a customer or supplier: what is wrong with
 * it, if it is an EU number, and the number written the standard way. A
 * number from outside the EU (GB, CH, NO, a US EIN) is kept as typed: there is
 * no register here to hold it to.
 */
export function euVatNumber(input: string | null | undefined, country?: string | null): { value: string | null; problem: string | null } {
  const typed = input?.trim() ?? "";
  if (!typed) return { value: null, problem: null };
  const split = splitVatNumber(typed);
  const fallback = country === "GR" ? "EL" : country ?? null;
  const foreignPrefix = !split.country && /^[A-Z]{2}/.test(split.number) && !(fallback && VIES_COUNTRIES[fallback] && SHAPES[fallback][0].test(split.number));
  if (foreignPrefix || !(split.country ?? (fallback && VIES_COUNTRIES[fallback] ? fallback : null))) return { value: typed.toUpperCase().replace(/\s+/g, ""), problem: null };
  const check = checkVatNumber(typed, fallback);
  return check.ok ? { value: check.display, problem: null } : { value: typed, problem: check.problem };
}

/** Company names as VIES gives them ("NORDLICHT SOFTWARE GMBH") and as people type them, compared without case, punctuation or legal form. */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): "match" | "differs" | "unknown" {
  const words = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9Ͱ-Ͽ ]+/g, " ")
    .split(/\s+/).filter(word => word && !LEGAL_FORMS.has(word));
  if (!a || !b || a.trim() === "---" || b.trim() === "---") return "unknown";
  const left = new Set(words(a)), right = new Set(words(b));
  if (!left.size || !right.size) return "unknown";
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.min(left.size, right.size) >= 0.6 ? "match" : "differs";
}
const LEGAL_FORMS = new Set(["ltd", "limited", "plc", "llc", "gmbh", "ag", "kg", "ug", "bv", "nv", "sa", "sas", "sarl", "srl", "spa", "ab", "as", "aps", "oy", "oyj", "sl", "slu", "sp", "zoo", "z", "o", "kft", "zrt", "doo", "sro", "ltda", "co", "the", "company", "and", "λτδ", "επε", "αε"]);
