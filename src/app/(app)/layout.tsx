import type { Metadata } from "next";

import { AUTH_MODE } from "@/lib/auth/config";
import { sql } from "@/lib/db";
import { getCurrentUser, getMembership, getOrganisations, getPractice } from "@/lib/org";
import { AppShell } from "@/components/shell/app-shell";
import { getRunningTimer } from "@/lib/data/work";

export const dynamic = "force-dynamic";

const COMPANY_ROLE: Record<string, string> = { owner: "Owner", staff: "Team", viewer: "Can look", auditor: "Auditor" };

export async function generateMetadata(): Promise<Metadata> {
  const practice = await getPractice();
  return {
    title: { default: `${practice.name} · Ledgerline`, template: `%s · ${practice.name}` },
    // A new address whenever the brand changes, so the browser fetches the new icon at once.
    icons: { icon: [{ url: `/api/icon?v=${encodeURIComponent(`${practice.initials}${practice.brand_color}`)}`, type: "image/svg+xml" }] },
  };
}

/** Everything behind sign-in: the menu, the top bar and the page, in the practice's colours. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, practice, organisations, membership, reviews] = await Promise.all([
    getCurrentUser(), getPractice(), getOrganisations(), getMembership(),
    sql<{ organisation_id: string | null; count: number }>("select organisation_id, count(*) as count from capture_items where status = 'review' group by organisation_id"),
  ]);
  const toReview = reviews.reduce((sum, row) => sum + Number(row.count), 0);
  const running = membership.practice ? await getRunningTimer(user.name) : null;
  const role = membership.practice ? membership.role ?? "Practice" : membership.companies[0] ? `${COMPANY_ROLE[membership.companies[0].role] ?? "Team"}, ${membership.companies[0].name.replace(/ (Ltd|Limited)$/, "")}` : "";
  // The practice's colour at the root, where the whole brand ramp is mixed from it. The database only holds #rrggbb.
  const brand = /^#[0-9a-fA-F]{6}$/.test(practice.brand_color) ? practice.brand_color : "#0d6e6e";
  return <>
    <style>{`:root{--brand:${brand}}`}</style>
    <AppShell practice={{ name: practice.name, initials: practice.initials, brand_color: practice.brand_color, tagline: practice.tagline }}
      user={{ name: user.name, initials: user.initials, email: user.email, role, demo: AUTH_MODE === "demo" }} member={membership.practice} toReview={toReview}
      timer={running ? { company: running.company, slug: running.slug, work: running.work, started_at: running.started_at } : null}
      clients={organisations.map(org => ({ id: org.id, slug: org.slug, name: org.name, industry: org.industry, practice: org.is_practice, country: org.country, toReview: Number(reviews.find(row => row.organisation_id === org.id)?.count ?? 0) }))}>
      {children}
    </AppShell>
  </>;
}
