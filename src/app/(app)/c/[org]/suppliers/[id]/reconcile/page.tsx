import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCheckSetup } from "@/lib/data/statement-checks";
import { UUID_PATTERN, firmToday, validRecordDate } from "@/lib/domain/invoices";
import { formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { TextInput } from "@/components/common/form-fields";
import { NavigationForm } from "@/components/navigation/navigation-form";
import { RecordHeader } from "@/components/records/record-layout";
import { StatementCheckForm } from "@/components/purchases/statement-check-form";

export const metadata: Metadata = { title: "Check their statement" };

/** The last day of the month before today's: when most suppliers' statements are drawn up. */
function lastMonthEnd(today: string) {
  return new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
}

/** A statement a supplier sent, checked against the books on its date. */
export default async function CheckStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(id)) notFound();
  const date = query.date && validRecordDate(query.date) ? query.date : lastMonthEnd(firmToday());
  const setup = await getCheckSetup(id, date);
  if (!setup) notFound();
  const lines = (list: typeof setup.before) => list.map(({ date, kind, reference, charged, settled }) => ({ date, kind, reference, charged, settled }));
  return <PageBody className="space-y-4">
    <RecordHeader eyebrow="Check their statement" title={setup.supplier.name}
      description={setup.last ? `Last checked on their statement of ${formatDate(setup.last.statement_date)}: ${setup.last.agreed ? "agreed" : "a difference left"}` : undefined}
      back={{ href: `/accounts/suppliers/${id}`, label: "Supplier" }} />
    <NavigationForm action={`/accounts/suppliers/${id}/reconcile`} className="flex flex-wrap items-end gap-2">
      <label className="text-ink-muted space-y-1 text-[12px]">
        <span className="block">Their statement is dated</span>
        <TextInput type="date" name="date" defaultValue={date} aria-label="Their statement's date" className="touch:h-11" />
      </label>
      <button className="border-hairline-strong text-ink hover:bg-muted h-8 rounded-md border px-3 text-[13px] font-medium touch:h-11">Show</button>
    </NavigationForm>
    <StatementCheckForm key={date} supplierId={id} date={date} ours={setup.ours} before={lines(setup.before)} after={lines(setup.after)} />
  </PageBody>;
}
