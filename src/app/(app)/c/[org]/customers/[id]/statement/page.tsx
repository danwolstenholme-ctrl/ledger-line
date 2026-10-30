import type { Metadata } from "next";

import { StatementPage } from "@/components/statements/statement-page";

export const metadata: Metadata = { title: "Statement" };

/** The customer's statement of account: activity in a period, or open items on a day (lib/domain/statements). */
export default async function CustomerStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StatementPage party="customer" id={(await params).id} searchParams={await searchParams} />;
}
