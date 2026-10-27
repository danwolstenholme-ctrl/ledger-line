import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { setRequestCurrency } from "@/lib/format";
import { getMembership, getOrgBySlug } from "@/lib/org";
import { RegimeProvider } from "@/components/common/regime";

/** One client company's books, in its own country's terms and currency. The proxy names the company on every request beneath this. */
export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [company, membership] = await Promise.all([getOrgBySlug(org), getMembership()]);
  if (!company) notFound();
  setRequestCurrency(company.currency);
  // Someone who reads these books and changes nothing (the database holds them to it) is told so once, at the top.
  const role = membership.practice ? null : membership.companies.find(entry => entry.slug === org)?.role;
  return <RegimeProvider country={company.country}>
    {role === "viewer" || role === "auditor" ? <div className="mx-auto w-full max-w-[1440px] px-3 pt-3 sm:px-5 sm:pt-5">
      <p role="note" className="border-hairline bg-surface-sunken text-ink-muted rounded-md border px-3 py-2 text-[12px] leading-relaxed">
        {role === "auditor" ? `You’re here as ${company.name}’s auditor` : `You can look at ${company.name}’s books`}: read anything and download any report or the audit file. Nothing can be changed from this account.
      </p>
    </div> : null}
    {children}
  </RegimeProvider>;
}
