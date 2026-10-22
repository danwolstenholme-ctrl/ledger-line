import Link from "@/components/navigation/navigation-link";

import type { JournalLineViewRow } from "@/types/database";
import { formatAmount, formatDate } from "@/lib/format";
import { RecordSection } from "@/components/records/record-layout";

/**
 * What a document did to the books: each entry it posted, debits and credits
 * by account. The accountant's first question about any bill or payment.
 */
export function Postings({ entries, empty }: { entries: { entryId: string; date: string; narration: string; lines: JournalLineViewRow[] }[]; empty: string }) {
  return <RecordSection title="How it posted" hint="The entries in the ledger">
    {entries.length ? entries.map(entry => <div key={entry.entryId} className="border-hairline border-b last:border-b-0">
      <p className="text-ink-muted px-4 pt-2.5 text-[12px] sm:px-5">{formatDate(entry.date)} · {entry.narration}</p>
      <table className="w-full border-collapse">
        <thead className="sr-only"><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
        <tbody>{entry.lines.map(line => <tr key={line.id}>
          <td className="px-4 py-1 text-[12.5px] sm:px-5"><Link href={`/accounts/chart/${line.account_id}`} className="text-ink hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center"><span className="text-ink-faint mr-2 font-mono text-[11.5px]">{line.account_code}</span>{line.account_name}</Link></td>
          <td className="w-28 px-2 py-1 text-right text-[12.5px] tabular-nums">{Number(line.debit) ? formatAmount(Number(line.debit)) : ""}</td>
          <td className="w-28 px-4 py-1 text-right text-[12.5px] tabular-nums sm:px-5">{Number(line.credit) ? formatAmount(Number(line.credit)) : ""}</td>
        </tr>)}</tbody>
      </table>
      <div className="pb-2" />
    </div>) : <p className="text-ink-faint px-4 py-3 text-[12.5px] sm:px-5">{empty}</p>}
  </RecordSection>;
}
