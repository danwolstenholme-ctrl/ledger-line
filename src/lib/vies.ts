import "server-only";

import { one, sql } from "@/lib/db";
import { checkVatNumber, sameCompany, splitVatNumber, VIES_COUNTRIES } from "@/lib/domain/eu-vat";
import type { VatAnswerView } from "@/components/vat/vat-check";

/**
 * VIES, the European Commission's VAT number register, over its REST API.
 * The answer is whether the number is registered for trade between EU
 * states today, the name and address the member state discloses (Germany and
 * some others disclose none), and, when the company asking gives its own VAT
 * number, a consultation number: the evidence a tax inspector asks for when a
 * sale was zero-rated under the reverse charge.
 *
 * The demo's companies are invented, so they are not in the real register:
 * their numbers are answered from vies_demo_register and marked as demo
 * answers. Every other number goes to the Commission. With
 * LEDGERLINE_VIES_FIXTURES=1 (the tests) nothing leaves the machine.
 */

const BASE = "https://ec.europa.eu/taxation_customs/vies/rest-api";

export type ViesAnswer =
  | { ok: true; valid: boolean; name: string | null; address: string | null; consultation: string | null; source: "vies" | "demo"; requesterRefused?: boolean; nameMatch?: "match" | "differs" | null }
  | { ok: false; error: string; message: string };

const MESSAGES: Record<string, (country: string) => string> = {
  INVALID_INPUT: () => "VIES couldn’t read that number: check the country and the digits.",
  INVALID_REQUESTER_INFO: () => "VIES didn’t accept the VAT number given for the company asking.",
  MS_UNAVAILABLE: country => `${country}’s register isn’t answering VIES just now. Member states take theirs down for maintenance; try again in a few minutes.`,
  MS_MAX_CONCURRENT_REQ: country => `${country}’s register is busy. Try again in a minute.`,
  GLOBAL_MAX_CONCURRENT_REQ: () => "VIES is busy. Try again in a minute.",
  SERVICE_UNAVAILABLE: () => "VIES isn’t answering just now. Try again shortly.",
  TIMEOUT: () => "VIES took too long to answer. Try again.",
  NETWORK: () => "Ledgerline couldn’t reach VIES. Check the internet connection and try again.",
};
const describe = (error: string, country: string) => (MESSAGES[error] ?? MESSAGES.SERVICE_UNAVAILABLE)(VIES_COUNTRIES[country] ?? country);
/** VIES writes "---" for what a member state does not disclose, and addresses with line breaks. */
const clean = (value: unknown) => {
  const text = typeof value === "string" ? value.replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ").trim() : "";
  return !text || /^-+$/.test(text) ? null : text;
};

async function post(country: string, number: string, requester: { country: string; number: string } | null, traderName: string | null): Promise<ViesAnswer> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/check-vat-number`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store",
      body: JSON.stringify({ countryCode: country, vatNumber: number, ...(requester ? { requesterMemberStateCode: requester.country, requesterNumber: requester.number } : {}), ...(traderName ? { traderName } : {}) }),
    });
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
    return { ok: false, error: code, message: describe(code, country) };
  }
  let body: Record<string, unknown>;
  try { body = await response.json(); } catch { return { ok: false, error: "SERVICE_UNAVAILABLE", message: describe("SERVICE_UNAVAILABLE", country) }; }
  if (body.actionSucceed === false || typeof body.valid !== "boolean") {
    const code = String((body.errorWrappers as { error?: string }[] | undefined)?.[0]?.error ?? "SERVICE_UNAVAILABLE");
    return { ok: false, error: code, message: describe(code, country) };
  }
  // Some member states that keep the name to themselves will still say whether the name given matches it.
  const nameMatch = body.traderNameMatch === "VALID" ? "match" : body.traderNameMatch === "INVALID" ? "differs" : null;
  return { ok: true, valid: body.valid, name: clean(body.name), address: clean(body.address), consultation: clean(body.requestIdentifier), source: "vies", nameMatch };
}

/**
 * Ask VIES about one number. `requester` is the company asking: with it, VIES
 * issues a consultation number. If VIES will not take the requester's number,
 * it is asked again without one, so the check itself still happens.
 * `expectName` is the name the books have for the business: sent along for
 * the member states that match names without disclosing them.
 */
export async function askVies(country: string, number: string, requester: { country: string; number: string } | null, expectName: string | null = null): Promise<ViesAnswer> {
  const demo = await one<{ valid: boolean; name: string | null; address: string | null }>("select valid, name, address from vies_demo_register where country = $1 and number = $2", [country, number]);
  if (demo) return { ok: true, valid: demo.valid, name: demo.name, address: demo.address, consultation: null, source: "demo" };
  if (process.env.LEDGERLINE_VIES_FIXTURES === "1") return { ok: true, valid: false, name: null, address: null, consultation: null, source: "demo" };
  let answer = await post(country, number, requester, expectName);
  // A busy register usually frees up within seconds: two more tries before giving up.
  for (let attempt = 1; attempt <= 2 && !answer.ok && /MAX_CONCURRENT_REQ/.test(answer.error); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    answer = await post(country, number, requester, expectName);
  }
  if (!answer.ok && requester && /REQUESTER|INVALID_INPUT/.test(answer.error)) {
    const again = await post(country, number, null, expectName);
    return again.ok ? { ...again, requesterRefused: true } : again;
  }
  return answer;
}

let status: { at: number; value: Record<string, boolean> | null } | null = null;
/** Which member states' registers are answering, as VIES reports it. Asked at most once a minute. */
export async function viesAvailability(): Promise<Record<string, boolean> | null> {
  if (process.env.LEDGERLINE_VIES_FIXTURES === "1") return Object.fromEntries(Object.keys(VIES_COUNTRIES).map(code => [code, true]));
  if (status && Date.now() - status.at < 60_000) return status.value;
  let value: Record<string, boolean> | null = null;
  try {
    const response = await fetch(`${BASE}/check-status`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    const body = await response.json() as { countries?: { countryCode: string; availability: string }[] };
    value = Object.fromEntries((body.countries ?? []).map(row => [row.countryCode, row.availability === "Available"]));
  } catch { value = null; }
  status = { at: Date.now(), value };
  return value;
}

export type VatCheckRow = { id: string; organisation_id: string; requester_name: string; country: string; number: string; valid: boolean | null; name: string | null; address: string | null; consultation: string | null; asked_name: string | null; name_match: "match" | "differs" | null; error: string | null; source: "vies" | "demo"; checked_by: string; checked_at: string };

/** A check older than this is re-done before the next zero-rated sale: a registration can be cancelled at any time. */
export const STALE_AFTER_DAYS = 90;

/** The latest answered check of each number asked about, keyed "DE298765435". */
export async function latestChecks(numbers: string[]) {
  const keys = [...new Set(numbers.filter(Boolean).map(number => { const split = splitVatNumber(number); return split.country ? `${split.country}${split.number}` : ""; }).filter(Boolean))];
  if (!keys.length) return new Map<string, VatCheckRow>();
  const rows = await sql<VatCheckRow>(`select distinct on (c.country, c.number) c.*, o.name as requester_name from vat_checks c join organisations o on o.id = c.organisation_id
    where c.country || c.number = any($1::text[]) and c.error is null order by c.country, c.number, c.checked_at desc`, [keys]);
  return new Map(rows.map(row => [`${row.country}${row.number}`, row]));
}

/** A kept check, as the pages show it. */
export function answerView(row: VatCheckRow | undefined | null, expectName?: string | null): VatAnswerView | null {
  if (!row) return null;
  return {
    number: `${row.country}${row.number}`, countryName: VIES_COUNTRIES[row.country] ?? row.country, valid: row.valid, name: row.name, address: row.address,
    consultation: row.consultation, checkedAt: row.checked_at, source: row.source, error: row.error, requester: row.requester_name,
    match: row.name ? sameCompany(row.name, expectName) : row.name_match && row.asked_name && sameCompany(row.asked_name, expectName) === "match" ? row.name_match : "unknown",
    stale: Date.now() - Date.parse(row.checked_at) > STALE_AFTER_DAYS * 86_400_000,
  };
}

/** The key latestChecks uses for a number as it is kept on a customer or supplier. */
export function vatKey(number: string | null | undefined, country?: string | null) {
  if (!number) return null;
  const shape = checkVatNumber(number, country);
  return shape.ok ? shape.display : null;
}
