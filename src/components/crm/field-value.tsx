import type { Field } from "@/lib/domain/business-types";
import { showFieldValue } from "@/lib/domain/business-types";
import { formatAmount, formatDate } from "@/lib/format";
import { MapLink } from "@/components/crm/contact-links";

/** One of the company's own fields as it reads on a record: a link opens, an address opens in maps. Null when there is nothing in it. */
export function fieldValue(field: Pick<Field, "kind" | "key">, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "link") return <a href={String(value)} className="text-brand break-all hover:underline" target="_blank" rel="noreferrer">{String(value)}</a>;
  if (field.kind === "text" && /address/.test(field.key)) return <MapLink address={String(value)} />;
  return showFieldValue(field, value, amount => formatAmount(amount), formatDate);
}
