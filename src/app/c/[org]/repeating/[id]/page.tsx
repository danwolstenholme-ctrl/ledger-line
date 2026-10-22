import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Pause, Play, Trash2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { deleteRepeating, setRepeatingActive } from "@/lib/actions/sales";
import { getRepeatingInvoice } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { SubmitButton } from "@/components/common/form-fields";
import { RecordBadge, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { RaiseDueButton, RepeatingForm } from "@/components/sales/repeating-forms";
import { InvoiceStatusBadge } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Repeating invoice" };

export default async function RepeatingInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, query] = await Promise.all([getRepeatingInvoice(id), searchParams]);
  if (!data) notFound();
  const { row, raised, org, today } = data;
  const ended = Boolean(row.ends_on && row.next_on > row.ends_on);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={row.name} back={{ href: "/accounts/repeating", label: "Repeating invoices" }}
      description={`${row.client_name} · ${formatAmount(row.total)} each · ${row.raised} raised so far`}
      action={!row.is_active ? <RecordBadge>{ended ? "Ended" : "Paused"}</RecordBadge> : row.due ? <RecordBadge tone="caution">Due</RecordBadge> : <RecordBadge tone="positive">Next on {formatDate(row.next_on)}</RecordBadge>} />
    {query.started ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]">
      <CheckCircle2 className="size-4 shrink-0" />Repeating. The next invoice is due on {formatDate(row.next_on)}; it is raised from Repeating invoices, or from here, when that day comes.
    </p> : null}
    {query.raised ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]">
      <CheckCircle2 className="size-4 shrink-0" /><span>{query.raised.split(",").length} invoice{query.raised.split(",").length === 1 ? "" : "s"} raised: {query.raised.split(",").join(", ")}.{query.problem ? ` ${query.problem}` : ""}</span>
    </p> : null}
    {row.due ? <section className="ll-panel border-caution-line bg-caution-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-ink text-[12.5px]">Due since {formatDate(row.next_on)}.</p>
      <RaiseDueButton id={row.id} count={1} label="Raise it now" />
    </section> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <RecordSection title="Schedule">
        <div className="p-4 sm:p-5">
          <RepeatingForm today={today} values={{ id: row.id, name: row.name, every_months: row.every_months, next_on: row.next_on, ends_on: row.ends_on, issue: row.issue }} />
        </div>
        <div className="border-hairline flex flex-wrap items-center gap-3 border-t px-4 py-3">
          {!ended ? <form action={setRepeatingActive}><input type="hidden" name="id" value={row.id} /><input type="hidden" name="active" value={row.is_active ? "false" : "true"} />
            <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">{row.is_active ? <><Pause className="size-3.5" />Pause</> : <><Play className="size-3.5" />Resume</>}</SubmitButton>
          </form> : null}
          <form action={deleteRepeating}><input type="hidden" name="id" value={row.id} />
            <SubmitButton size="sm" variant="outline" pendingLabel="Stopping…"><Trash2 className="size-3.5" />Stop and delete the schedule</SubmitButton>
          </form>
          <p className="text-ink-faint w-full text-[11.5px]">The invoices it has raised stay as they are.</p>
        </div>
      </RecordSection>
      <RecordSection title="Raised" hint={raised.length ? `${raised.length} invoice${raised.length === 1 ? "" : "s"}` : undefined}>
        {raised.length ? <table className="w-full border-collapse text-[12.5px]"><tbody className="divide-hairline divide-y">{raised.map(invoice => <tr key={invoice.id} className="hover:bg-surface-sunken">
          <td className="px-4 py-2"><Link href={`/invoices/${invoice.id}`} className="text-brand font-mono hover:underline">{invoice.number}</Link></td>
          <td className="text-ink-muted px-2 py-2 whitespace-nowrap">{formatDate(invoice.issued_on)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{formatAmount(invoice.total)}</td>
          <td className="px-4 py-2 text-right"><InvoiceStatusBadge status={invoice.status} daysOverdue={invoice.days_overdue} credited={Number(invoice.amount_credited)} total={Number(invoice.total)} /></td>
        </tr>)}</tbody></table> : <p className="text-ink-muted px-4 py-3 text-[12.5px]">Nothing raised yet.</p>}
      </RecordSection>
    </div>
    <p className="text-ink-faint text-[11.5px]">{org.name}&apos;s invoices are numbered in one sequence, so each raised invoice takes the next number when it is raised.</p>
  </PageBody>;
}
