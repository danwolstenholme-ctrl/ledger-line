import { requireOrg } from "@/lib/org";
import { getAgedPayables } from "@/lib/data/accounts";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { csvResponse, unavailable } from "@/lib/data/csv";
import { resolvePeriod, toDate } from "@/lib/domain/accounts";
import { firmToday } from "@/lib/domain/invoices";

/** Aged payables as a CSV, as at the day the page shows: `?range=…` or `?range=custom&to=…`. */
export async function GET(request: Request) {
  const org = await requireOrg();
  const today = firmToday();
  const period = toDate(resolvePeriod(Object.fromEntries(new URL(request.url).searchParams), today, org.year_end_month, "this_month"), today);
  const report = await getAgedPayables({ at: period.to });
  if (report.failed) return unavailable("aged payables");
  const plain = (value: number) => value.toFixed(2);
  const rows = report.suppliers.map(supplier => [supplier.name, String(supplier.count), String(supplier.oldest), ...AGEING_BUCKETS.map(bucket => plain(supplier.buckets[bucket.key])), plain(-supplier.credit), plain(supplier.total)]);
  rows.push(["All suppliers", String(report.count), "", ...AGEING_BUCKETS.map(bucket => plain(report.totals[bucket.key])), plain(-report.credit), plain(report.total)]);
  return csvResponse(`aged-payables-${report.at}`, ["Supplier", "Bills", "Oldest days overdue", ...AGEING_BUCKETS.map(bucket => bucket.label), "Credit to use", "Total"], rows);
}
