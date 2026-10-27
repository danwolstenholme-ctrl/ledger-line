import "server-only";

import { randomUUID } from "node:crypto";

import { setUpWorkspace } from "@/lib/db/workspace-setup";
import { OPENING_ACCOUNTS, chartFor } from "@/lib/domain/chart";
import { regimeOf } from "@/lib/domain/regimes";

/**
 * Opening a client company's books: the company in its own country's terms
 * (currency, chart of accounts, VAT and deadlines), shaped to its kind of
 * business, and its fee in the practice's own books. The same for one client
 * taken on through its file and for a practice's whole list imported at once.
 */

type Run = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

export type NewCompany = {
  practiceId: string; name: string; business: string; businessType: string; country: "CY" | "GB"; heNumber: string | null; vatNumber: string | null; vatRegistered: boolean; tic?: string | null;
  quarterEndMonth: number; yearEndMonth: number; contactName: string | null; contactEmail: string | null; address: string | null; manager: string | null; booksFrom: string; incorporatedOn: string | null;
  fee: { monthly: number; hourly: number; app: number };
};

export const slugFor = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(ltd|limited|plc|llc)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
export const prefixFor = (name: string) => `${name.replace(/\b(Ltd|Limited|Co|PLC)\b\.?/gi, "").trim().split(/\s+/).slice(0, 3).map(word => word[0]).join("").toUpperCase() || "INV"}-`;

/** A slug no company has yet. `taken`: those already used in this same transaction. */
export async function freeSlug(run: Run, name: string, taken: Set<string> = new Set()) {
  let slug = slugFor(name);
  for (let n = 2; taken.has(slug) || (await run("select 1 from organisations where slug = $1", [slug])).length; n++) slug = `${slugFor(name)}-${n}`;
  taken.add(slug);
  return slug;
}

export async function openCompany(run: Run, company: NewCompany, slug: string) {
  const org = randomUUID(), bank = randomUUID();
  const [practiceOrg] = await run<{ id: string }>("select id from organisations where practice_id = $1 and is_practice limit 1", [company.practiceId]);
  await run(`insert into organisations (id, practice_id, slug, name, industry, he_number, vat_number, tic, vat_registered, vat_quarter_end_month, year_end_month, contact_name, contact_email, address,
      invoice_prefix, manager, books_from, incorporated_on, country, currency) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [org, company.practiceId, slug, company.name, company.business || "Client company", company.heNumber, company.vatRegistered ? company.vatNumber : null, company.tic ?? null, company.vatRegistered,
     company.quarterEndMonth, company.yearEndMonth, company.contactName, company.contactEmail, company.address, prefixFor(company.name), company.manager, company.booksFrom,
     company.incorporatedOn, company.country, regimeOf(company.country).currency]);
  const accounts = [...OPENING_ACCOUNTS, ...chartFor(company.country)].map(account => ({ id: account.code === "090" ? bank : randomUUID(), organisation_id: org, code: account.code, name: account.name,
    type: account.type, system_role: account.role ?? null, description: account.description ?? null, bank_details: null, outside_vat: Boolean(account.outsideVat) }));
  await run(`insert into ledger_accounts (id, organisation_id, code, name, type, system_role, description, bank_details, outside_vat)
    select id, organisation_id, code, name, type, system_role, description, bank_details, outside_vat from jsonb_populate_recordset(null::ledger_accounts, $1::jsonb)`, [JSON.stringify(accounts)]);
  await run("update organisations set default_bank_account_id = $2 where id = $1", [org, bank]);
  // Shaped to its kind of business: what it calls things, its stages and fields, and the parts it uses.
  await setUpWorkspace(run, run, org, company.businessType, company.country);
  // Its fee, invoiced from the practice's own books.
  if (practiceOrg) {
    const [fees] = await run<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [practiceOrg.id]);
    const [customer] = await run<{ id: string }>(`insert into customers (organisation_id, name, email, vat_number, country, address, default_account_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [practiceOrg.id, company.name, company.contactEmail, company.vatRegistered ? company.vatNumber : null, company.country, company.address, fees?.id ?? null]);
    await run("insert into client_fees (organisation_id, customer_id, monthly_fee, hourly_rate, app_fee) values ($1, $2, $3, $4, $5)", [org, customer.id, company.fee.monthly, company.fee.hourly, company.fee.app]);
  }
  return org;
}
