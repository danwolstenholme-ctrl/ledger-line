import type { Metadata } from "next";

import { AUTH_MODE } from "@/lib/auth/config";
import { one, sql } from "@/lib/db";
import { headers } from "next/headers";
import { ORG_HEADER, getCurrentUser, getMembership, getPractice } from "@/lib/org";
import { getShellCompany } from "@/lib/data/shell";
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
  const slug = (await headers()).get(ORG_HEADER);
  const [user, practice, membership, reviews, count, initialCompany] = await Promise.all([
    getCurrentUser(), getPractice(), getMembership(),
    sql<{ count: number }>("select count(*) as count from capture_items where status = 'review'"),
    one<{ count: number }>("select count(*) as count from organisations where not is_practice"),
    // The company being looked at, for the first page's menu; its own layout keeps it current after that (CompanyShellSync).
    slug ? getShellCompany(slug) : null,
  ]);
  const toReview = Number(reviews[0]?.count ?? 0);
  const running = membership.practice ? await getRunningTimer(user.name) : null;
  const role = membership.practice ? membership.role ?? "Practice" : membership.companies[0] ? `${COMPANY_ROLE[membership.companies[0].role] ?? "Team"}, ${membership.companies[0].name.replace(/ (Ltd|Limited)$/, "")}` : "";
  // The practice's colour at the root, where the whole brand ramp is mixed from it. The database only holds #rrggbb.
  const brand = /^#[0-9a-fA-F]{6}$/.test(practice.brand_color) ? practice.brand_color : "#0d6e6e";
  return <>
    <style>{`:root{--brand:${brand}}`}</style>
    <AppShell practice={{ name: practice.name, initials: practice.initials, brand_color: practice.brand_color, tagline: practice.tagline }}
      user={{ name: user.name, initials: user.initials, email: user.email, role, demo: AUTH_MODE === "demo" }} member={membership.practice} toReview={toReview}
      timer={running ? { company: running.company, slug: running.slug, work: running.work, started_at: running.started_at } : null}
      initialCompany={initialCompany} companyCount={Number(count?.count ?? 0)}>
      {children}
    </AppShell>
  </>;
}
