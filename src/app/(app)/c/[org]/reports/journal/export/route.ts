import { requireOrg } from "@/lib/org";
import { getJournalReport } from "@/lib/data/accounts";
import { JOURNAL_SOURCE_LABELS } from "@/lib/domain/accounts";
import { csvResponse, searchParams, unavailable } from "@/lib/data/csv";

/** One row per line, each carrying its entry: date, type, reference, narration, and who posted it when. */
export async function GET(request: Request) {
  await requireOrg();
  const report = await getJournalReport(searchParams(request));
  if (report.failed) return unavailable("journal report");
  const plain = (value: number) => value ? value.toFixed(2) : "";
  const rows = report.entries.flatMap(entry => entry.lines.map(line => [
    entry.entry_date, JOURNAL_SOURCE_LABELS[entry.source], entry.reference ?? "", entry.narration, line.account_code, line.account_name,
    line.description ?? "", plain(Number(line.debit)), plain(Number(line.credit)), entry.postedBy ?? "", entry.created_at,
  ]));
  return csvResponse(`journal-${report.period.from}-to-${report.period.to}`,
    ["Date", "Type", "Reference", "Narration", "Code", "Account", "Line detail", "Debit", "Credit", "Posted by", "Posted at"], rows);
}
