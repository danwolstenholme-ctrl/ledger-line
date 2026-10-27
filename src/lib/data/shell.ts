import "server-only";

import { cache } from "react";

import { one, sql } from "@/lib/db";
import { MODULES } from "@/lib/domain/business-types";
import { getMembership, getOrgBySlug } from "@/lib/org";

/**
 * What the menu needs about the company being looked at: its name, what it
 * calls things, the parts it uses, and what is waiting in it. One company's,
 * however many the practice keeps: the switcher fetches the list of them when
 * it is opened (/api/shell/companies), so no page carries every client.
 */

const COMPANY_ROLE: Record<string, string> = { owner: "Owner", staff: "Team", viewer: "Can look", auditor: "Auditor" };
/** What someone at a client company is there, for the account menu: "Owner, Larnaca Bay Trading". */
export const companyRoleLabel = (role: string, company: string) => `${COMPANY_ROLE[role] ?? "Team"}, ${company.replace(/ (Ltd|Limited)$/, "")}`;

export type ShellCompany = {
  slug: string; name: string; industry: string; practice: boolean; country: string; toReview: number;
  /** The person may see its payroll: the practice, and the company's owner and auditor. */
  payroll: boolean;
  /** What the person is at this company, when they are one of its own people rather than the practice's. */
  role: string | null;
  nav: { customers: string; deals: string; jobs: string; modules: string[] };
};

export const getShellCompany = cache(async (slug: string): Promise<ShellCompany | null> => {
  const org = await getOrgBySlug(slug);
  if (!org) return null;
  const [settings, review, membership] = await Promise.all([
    one<{ customer_many: string; deal_many: string; job_many: string; modules: string[] }>("select customer_many, deal_many, job_many, modules from workspace_settings where organisation_id = $1", [org.id]),
    one<{ count: number }>("select count(*) as count from capture_items where organisation_id = $1 and status = 'review'", [org.id]),
    getMembership(),
  ]);
  const mine = membership.practice ? null : membership.companies.find(company => company.slug === slug);
  return {
    slug: org.slug, name: org.name, industry: org.industry, practice: org.is_practice, country: org.country, toReview: Number(review?.count ?? 0),
    payroll: membership.practice || membership.companies.some(company => company.slug === slug && (company.role === "owner" || company.role === "auditor")),
    role: mine ? companyRoleLabel(mine.role, org.name) : null,
    nav: settings ? { customers: settings.customer_many, deals: settings.deal_many, jobs: settings.job_many, modules: settings.modules } : { customers: "Customers", deals: "Enquiries", jobs: "Jobs", modules: [...MODULES] },
  };
});

/** Every company the person can see, as the switcher, the timer and the search find them. */
export async function getCompanyList() {
  return sql<{ id: string; slug: string; name: string; practice: boolean; greek: string | null; he: string | null; vat: string | null; to_review: number }>(`
    select o.id, o.slug, o.name, o.is_practice as practice, nullif(o.greek_name, '') as greek, o.he_number as he, o.vat_number as vat,
           (select count(*) from capture_items c where c.organisation_id = o.id and c.status = 'review') as to_review
      from organisations o order by o.name`);
}
