import { todayIn } from "@/lib/domain/invoice-math";
import { FIRM_TIME_ZONE } from "@/lib/format";

/** Today in Cyprus as YYYY-MM-DD. LEDGERLINE_TODAY pins it for tests. */
export function firmToday(now: Date = new Date()) { return process.env.LEDGERLINE_TODAY || todayIn(FIRM_TIME_ZONE, now); }
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validRecordDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
