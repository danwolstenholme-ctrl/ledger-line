import { requireOrg } from "@/lib/org";
import { getAsAtPeriod, getLedgerBalances } from "@/lib/data/accounts";
import { ACCOUNT_TYPES, trialBalance } from "@/lib/domain/accounts";
import { csvResponse, searchParams, unavailable } from "@/lib/data/csv";

export async function GET(request: Request) {
  await requireOrg();
  const period = await getAsAtPeriod(searchParams(request));
  const balances = await getLedgerBalances(period.yearFrom, period.asAt);
  if (balances.failed) return unavailable("trial balance");
  const tb = trialBalance(balances.rows);
  const plain = (value: number) => value ? value.toFixed(2) : "";
  const rows = tb.lines.map(line => [line.code, line.name, ACCOUNT_TYPES[line.type].label, plain(line.debit), plain(line.credit)]);
  rows.push(["", "Total", "", tb.debit.toFixed(2), tb.credit.toFixed(2)]);
  return csvResponse(`trial-balance-${period.asAt}`, ["Code", "Account", "Type", "Debit", "Credit"], rows);
}
