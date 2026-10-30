import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getPaymentRuns } from "@/lib/data/purchases";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordEmpty, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Payment runs" };

/** Every time bills were paid together, newest first: each with its bank file and remittance advice. */
export default async function PaymentRunsPage() {
  const runs = await getPaymentRuns(200);
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap first:pl-4 last:pr-4";
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Payment runs" back={{ href: "/accounts/bills", label: "Bills" }} />
    <Panel className="overflow-hidden">
      {runs.length ? <table className="w-full border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Paid on</th><th scope="col" className={head}>From</th><th scope="col" className={head}>Bills</th><th scope="col" className={`${head} text-right`}>Amount</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{runs.map(run => <tr key={run.id}>
          <td className="py-2.5 pr-3 pl-4 text-[13px] tabular-nums"><Link href={`/accounts/bills/runs/${run.id}`} className="text-brand hover:underline">{formatDate(run.paid_on)}</Link>{run.reference ? <span className="text-ink-faint"> · {run.reference}</span> : null}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px]">{run.bank_name}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px]">{Number(run.count)} bill{Number(run.count) === 1 ? "" : "s"}, {Number(run.suppliers)} supplier{Number(run.suppliers) === 1 ? "" : "s"}</td>
          <td className="py-2.5 pr-4 pl-3 text-right text-[13px] font-medium tabular-nums">{formatAmount(Number(run.total))}</td>
        </tr>)}</tbody>
      </table> : <RecordEmpty title="No payment runs yet">Tick bills on the Bills page to pay several at once: a run makes the bank file and each supplier’s remittance advice.</RecordEmpty>}
    </Panel>
  </PageBody>;
}
