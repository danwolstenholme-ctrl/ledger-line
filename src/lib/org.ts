import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { one, sql } from "@/lib/db";
import { booksHref } from "@/lib/domain/paths";
import { setRequestCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
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
  // Its figures are in its own currency from here on (lib/format).
  setRequestCurrency(org.currency);
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

/** The practice the person works at, or, for a client's own people, the practice that keeps their books. */
export const getPractice = cache(async () => {
  const practice = await one<PracticeRow>(`select p.* from practices p order by (p.id = any (my_practices())) desc, p.created_at limit 1`);
  if (!practice) redirect("/sign-in");
  return practice;
});
export const getOrganisations = cache(async () => sql<OrganisationRow>("select * from organisations order by name"));

/** `locale`: the language they read Ledgerline in (lib/i18n). */
export type CurrentUser = { id: string; name: string; email: string; initials: string; locale: Locale };
/** The person signed in, whoever request.jwt.claims names. Anyone who isn't is sent to sign in. */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const user = await one<CurrentUser>("select id, name, email, initials, locale from app_users where id = app_user_id()");
  if (!user) redirect("/sign-in");
  return user;
});

/** What the person is: one of the practice's people (with their role), or one of a client company's own. */
export const getMembership = cache(async () => {
  const row = await one<{ practice: boolean; practice_role: string | null; mlco: boolean | null; companies: { slug: string; name: string; role: string }[] | null }>(`
    select exists (select 1 from practice_staff where user_id = app_user_id()) as practice,
           (select role from practice_staff where user_id = app_user_id() limit 1) as practice_role,
           (select mlco from practice_staff where user_id = app_user_id() limit 1) as mlco,
           (select json_agg(json_build_object('slug', o.slug, 'name', o.name, 'role', m.role) order by o.name) from company_members m join organisations o on o.id = m.organisation_id where m.user_id = app_user_id()) as companies`);
  const companies = row?.companies ?? [];
  return { practice: Boolean(row?.practice), role: row?.practice_role ?? null, mlco: Boolean(row?.mlco), companies };
});

/** A practice page: the practice's people only. A client's own people go to their company. */
export async function requirePracticeMember() {
  const membership = await getMembership();
  if (membership.practice) return membership;
  redirect(membership.companies[0] ? `/c/${membership.companies[0].slug}` : "/sign-in");
}

/** The month a company's books begin: the month of its first entry. Deadlines and returns before it are not the books' to keep. */
export const getBooksStart = cache(async (orgId: string) =>
  (await one<{ start: string | null }>(`select to_char(coalesce(date_trunc('month', (select min(entry_date) from journal_entries where organisation_id = $1)), (select books_from from organisations where id = $1)), 'YYYY-MM-DD') as start`, [orgId]))?.start ?? "2025-07-01");
