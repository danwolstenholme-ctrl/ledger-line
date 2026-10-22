"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { one, sql } from "@/lib/db";
import { checkVatNumber, sameCompany, splitVatNumber, VIES_COUNTRIES } from "@/lib/domain/eu-vat";
import { getDemoUser } from "@/lib/org";
import { askVies } from "@/lib/vies";
import type { VatCheckResult, VatCheckState } from "@/lib/actions/state";

/**
 * Checking a VAT number: its shape and check digit first, which needs no
 * network, then VIES. The answer is kept, whatever it is, with the company
 * that asked (whose own VAT number earns the consultation number) and who
 * pressed the button: it goes on the audit trail as evidence.
 */

type Company = { id: string; name: string; vat_number: string | null; country: string };

async function record(company: Company, country: string, number: string, expectName: string | null, person: string): Promise<VatCheckResult> {
  const own = company.vat_number ? splitVatNumber(company.vat_number) : null;
  const requester = own?.country && own.number ? { country: own.country, number: own.number } : null;
  const answer = await askVies(country, number, requester, expectName);
  const row = await one<{ checked_at: string }>(`insert into vat_checks (organisation_id, country, number, valid, name, address, consultation, asked_name, name_match, error, source, checked_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning checked_at`,
    [company.id, country, number, answer.ok ? answer.valid : null, answer.ok ? answer.name : null, answer.ok ? answer.address : null, answer.ok ? answer.consultation : null,
     expectName, answer.ok ? answer.nameMatch ?? null : null, answer.ok ? null : answer.error, answer.ok ? answer.source : "vies", person]);
  return {
    number: `${country}${number}`, countryName: VIES_COUNTRIES[country] ?? country, valid: answer.ok ? answer.valid : null, name: answer.ok ? answer.name : null,
    address: answer.ok ? answer.address : null, consultation: answer.ok ? answer.consultation : null, checkedAt: row!.checked_at, source: answer.ok ? answer.source : "vies",
    match: !answer.ok ? "unknown" : answer.name ? sameCompany(answer.name, expectName) : answer.nameMatch ?? "unknown", error: answer.ok ? null : answer.message, requester: company.name,
    note: answer.ok && answer.requesterRefused ? `No consultation number: VIES didn’t recognise ${company.name}’s own VAT number, ${company.vat_number}. Check it in the company’s settings.` : null,
  };
}

/** One number, for one company: from a customer's or supplier's page, an invoice, or the practice's VAT numbers page. */
export async function checkVat(_previous: VatCheckState, form: FormData): Promise<VatCheckState> {
  const input = String(form.get("vat") ?? "");
  const organisation = String(form.get("organisation_id") ?? "");
  const expectName = String(form.get("expect_name") ?? "").trim() || null;
  const shape = checkVatNumber(input, String(form.get("country") ?? "") || null);
  if (!shape.ok) return { ok: false, error: shape.problem };
  const company = /^[0-9a-f-]{36}$/i.test(organisation) ? await one<Company>("select id, name, vat_number, 'CY' as country from organisations where id = $1", [organisation]) : null;
  if (!company) return { ok: false, error: "Choose the company asking: VIES records which company checked the number." };
  const user = await getDemoUser();
  const result = await record(company, shape.country, shape.number, expectName, user.name);
  revalidatePath("/", "layout");
  return { ok: !result.error, error: null, result };
}

/** Every EU business customer and EU supplier of every company, checked again in one go, one at a time so VIES is not crowded. */
export async function checkEveryVatNumber(): Promise<void> {
  const user = await getDemoUser();
  const parties = await sql<{ vat_number: string; country: string; name: string; organisation_id: string; org_name: string; org_vat: string | null; org_country: string }>(`
    select c.vat_number, c.country, c.name, o.id as organisation_id, o.name as org_name, o.vat_number as org_vat, 'CY' as org_country
      from customers c join organisations o on o.id = c.organisation_id where c.is_active and c.eu_business and c.vat_number is not null
    union all
    select s.vat_number, s.country, s.name, o.id, o.name, o.vat_number, 'CY'
      from suppliers s join organisations o on o.id = s.organisation_id where s.is_active and s.reverse_charge and s.vat_number is not null and s.country <> 'CY'`);
  let checked = 0;
  for (const party of parties) {
    const shape = checkVatNumber(party.vat_number, party.country);
    if (!shape.ok) continue;
    await record({ id: party.organisation_id, name: party.org_name, vat_number: party.org_vat, country: party.org_country }, shape.country, shape.number, party.name, user.name);
    checked += 1;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  revalidatePath("/", "layout");
  redirect(`/vat-numbers?checked=${checked}`);
}
