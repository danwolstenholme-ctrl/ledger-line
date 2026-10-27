import type { Metadata, Viewport } from "next";

import { AUTH_MODE } from "@/lib/auth/config";
import { one, sql } from "@/lib/db";
import { headers } from "next/headers";
import { ORG_HEADER, getCurrentUser, getMembership, getPractice } from "@/lib/org";
import { companyRoleLabel, getShellCompany } from "@/lib/data/shell";
import { AppShell } from "@/components/shell/app-shell";
import { getRunningTimer } from "@/lib/data/work";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const practice = await getPractice();
  return {
    title: { default: `${practice.name} · Ledgerline`, template: `%s · ${practice.name}` },
    // A new address whenever the brand changes, so the browser fetches the new icon at once.
    icons: { icon: [{ url: `/api/icon?v=${encodeURIComponent(`${practice.initials}${practice.brand_color}`)}`, type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  };
}

/** The phone's own bar in the practice's colour, as the rest of its white label. */
export async function generateViewport(): Promise<Viewport> {
  const practice = await getPractice();
  return { themeColor: /^#[0-9a-fA-F]{6}$/.test(practice.brand_color) ? practice.brand_color : "#0d6e6e" };
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
  const role = membership.practice ? membership.role ?? "Practice" : membership.companies[0] ? companyRoleLabel(membership.companies[0].role, membership.companies[0].name) : "";
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
