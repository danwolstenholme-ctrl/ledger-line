import { requireOrg } from "@/lib/org";
import { getGeneralLedger } from "@/lib/data/accounts";
import { JOURNAL_SOURCE_LABELS } from "@/lib/domain/accounts";
import { csvResponse, searchParams, unavailable } from "@/lib/data/csv";

/** One row per posted line, with each account's balance brought and carried forward: what an accountant loads into a spreadsheet. */
export async function GET(request: Request) {
  await requireOrg();
  const report = await getGeneralLedger(searchParams(request));
  if (report.failed) return unavailable("general ledger");
  const plain = (value: number) => value ? value.toFixed(2) : "";
  const rows = report.accounts.flatMap(account => [
    [report.period.from, account.code, account.name, "", "", "Brought forward", "", "", account.opening.toFixed(2)],
    ...account.lines.map(line => [line.entry_date, account.code, account.name, JOURNAL_SOURCE_LABELS[line.source], line.reference ?? "", line.description ?? line.narration,
      plain(Number(line.debit)), plain(Number(line.credit)), line.balance.toFixed(2)]),
    [report.period.to, account.code, account.name, "", "", "Carried forward", account.debit.toFixed(2), account.credit.toFixed(2), account.closing.toFixed(2)],
  ]);
  return csvResponse(`general-ledger-${report.period.from}-to-${report.period.to}`,
    ["Date", "Code", "Account", "Type", "Reference", "Detail", "Debit", "Credit", "Balance (debit positive)"], rows);
}
