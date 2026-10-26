import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { one, sql } from "@/lib/db";
import { booksHref } from "@/lib/domain/paths";
import type { OrganisationRow, PracticeRow } from "@/types/database";

/** proxy.ts names the company in the URL on every request under /c/{slug}. */
export const ORG_HEADER = "x-ledgerline-org";

export const getOrgBySlug = cache(async (slug: string) => one<OrganisationRow>("select * from organisations where slug = $1", [slug]));

/** The company whose books this request is about. 404 when there is none. */
export const requireOrg = cache(async () => {
  const slug = (await headers()).get(ORG_HEADER);
  if (!slug) notFound();
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  return org;
});

/** Same as requireOrg, for code that also runs outside a company (a practice page). */
export async function currentOrg() {
  const slug = (await headers()).get(ORG_HEADER);
  return slug ? getOrgBySlug(slug) : null;
}

export async function orgPath(path: string) {
  const org = await requireOrg();
  return booksHref(path, org.slug);
}

export const getPractice = cache(async () => (await one<PracticeRow>("select * from practices order by created_at limit 1"))!);
export const getOrganisations = cache(async () => sql<OrganisationRow>("select * from organisations order by name"));
/** The person signed in: whoever request.jwt.claims names. Until sign-in arrives, the demo's own user. */
export const getCurrentUser = cache(async () => (await one<{ id: string; name: string; email: string; initials: string }>("select id, name, email, initials from app_users where id = app_user_id()"))!);

/** The month a company's books begin: the month of its first entry. Deadlines and returns before it are not the books' to keep. */
export const getBooksStart = cache(async (orgId: string) =>
  (await one<{ start: string | null }>(`select to_char(coalesce(date_trunc('month', (select min(entry_date) from journal_entries where organisation_id = $1)), (select books_from from organisations where id = $1)), 'YYYY-MM-DD') as start`, [orgId]))?.start ?? "2025-07-01");
