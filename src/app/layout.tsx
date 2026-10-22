import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import type { CSSProperties } from "react";

import { sql } from "@/lib/db";
import { getDemoUser, getOrganisations, getPractice } from "@/lib/org";
import { AppShell } from "@/components/shell/app-shell";
import { getRunningTimer } from "@/lib/data/work";
import "./globals.css";

const roboto = Roboto({ subsets: ["latin", "greek"], variable: "--font-roboto", display: "swap" });
const robotoMono = Roboto_Mono({ subsets: ["latin", "greek"], variable: "--font-roboto-mono", display: "swap" });

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const practice = await getPractice();
  return {
    title: { default: `${practice.name} · Ledgerline`, template: `%s · ${practice.name}` },
    description: "Books, AI capture and a practice dashboard for Cyprus accountants.",
    robots: { index: false, follow: false },
    // A new address whenever the brand changes, so the browser fetches the new icon at once.
    icons: { icon: [{ url: `/api/icon?v=${encodeURIComponent(`${practice.initials}${practice.brand_color}`)}`, type: "image/svg+xml" }] },
  };
}

export const viewport: Viewport = { colorScheme: "light" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [practice, organisations, user, reviews] = await Promise.all([
    getPractice(), getOrganisations(), getDemoUser(),
    sql<{ organisation_id: string | null; count: number }>("select organisation_id, count(*) as count from capture_items where status = 'review' group by organisation_id"),
  ]);
  const toReview = reviews.reduce((sum, row) => sum + Number(row.count), 0);
  const running = await getRunningTimer(user.name);
  return <html lang="en-GB" className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`} style={{ "--brand": practice.brand_color } as CSSProperties}>
    <body className="bg-canvas text-ink min-h-full">
      <AppShell practice={{ name: practice.name, initials: practice.initials, brand_color: practice.brand_color, tagline: practice.tagline }} user={{ name: user.name, initials: user.initials }} toReview={toReview}
        timer={running ? { company: running.company, slug: running.slug, work: running.work, started_at: running.started_at } : null}
        clients={organisations.map(org => ({ id: org.id, slug: org.slug, name: org.name, industry: org.industry, practice: org.is_practice, toReview: Number(reviews.find(row => row.organisation_id === org.id)?.count ?? 0) }))}>
        {children}
      </AppShell>
    </body>
  </html>;
}
