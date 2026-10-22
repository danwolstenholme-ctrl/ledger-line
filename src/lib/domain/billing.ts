/** How late money owed is, in the buckets the ageing reports use. */
export const AGEING_BUCKETS = [
  { key: "current", label: "Current", note: "Not yet due" },
  { key: "d30", label: "1–30 days", note: "Just past due" },
  { key: "d60", label: "31–60 days", note: "Chasing" },
  { key: "d90", label: "61–90 days", note: "Escalate" },
  { key: "older", label: "Over 90 days", note: "At risk" },
] as const;
export type AgeingBucketKey = (typeof AGEING_BUCKETS)[number]["key"];

export function ageingBucket(daysOverdue: number): AgeingBucketKey {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d30";
  if (daysOverdue <= 60) return "d60";
  if (daysOverdue <= 90) return "d90";
  return "older";
}

/** Rows as CSV text: every cell quoted, quotes doubled, CRLF between rows. */
export function toCsv(header: readonly string[], rows: string[][]) {
  const cell = (value: string) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
}
