import { requireOrg } from "@/lib/org";
import { getAgedPayables } from "@/lib/data/accounts";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { csvResponse, unavailable } from "@/lib/data/csv";

export async function GET() {
  await requireOrg();
  const report = await getAgedPayables();
  if (report.failed) return unavailable("aged payables");
  const plain = (value: number) => value.toFixed(2);
  const rows = report.suppliers.map(supplier => [supplier.name, String(supplier.count), String(supplier.oldest), ...AGEING_BUCKETS.map(bucket => plain(supplier.buckets[bucket.key])), plain(supplier.total)]);
  rows.push(["All suppliers", String(report.count), "", ...AGEING_BUCKETS.map(bucket => plain(report.totals[bucket.key])), plain(report.total)]);
  return csvResponse(`aged-payables-${report.today}`, ["Supplier", "Bills", "Oldest days overdue", ...AGEING_BUCKETS.map(bucket => bucket.label), "Total"], rows);
}
