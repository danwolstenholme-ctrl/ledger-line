/**
 * IBANs and BICs, checked as banks check them: the country's length and the
 * mod-97 check digits. Client-safe.
 */

const LENGTHS: Record<string, number> = {
  AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26,
  IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
};

export const compactIban = (value: string) => value.replace(/[\s-]+/g, "").toUpperCase();

export function validIban(value: string) {
  const iban = compactIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const expected = LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;
  // Move the first four characters to the end, letters to numbers, and the remainder modulo 97 must be 1.
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

export const formatIban = (value: string) => compactIban(value).replace(/(.{4})/g, "$1 ").trim();

export const validBic = (value: string) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.replace(/\s+/g, "").toUpperCase());

/** The first IBAN written in a bank account's details, if there is one. */
export function ibanIn(text: string | null | undefined) {
  const found = (text ?? "").toUpperCase().match(/[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?/);
  return found && validIban(found[0]) ? compactIban(found[0]) : null;
}
