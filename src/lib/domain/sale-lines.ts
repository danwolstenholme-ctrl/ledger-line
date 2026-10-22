import { formatQuantity, priceInput } from "@/lib/domain/line-math";

/** A sold line as the line editor holds it, and a product it can be filled from. Server and client. */
export type SaleItemOption = { id: string; code: string | null; name: string; unit: string | null; unit_price: number; vat_rate: number; account_id: string };
export type SaleLineValue = { item_id: string | null; description: string; unit: string | null; quantity: string; unit_price: string; discount_pct: string; vat_rate: number; account_id: string };

/** Saved lines back into the editor's shape. A line saved as a single amount becomes one at that price. */
export function editorSaleLines(lines: { item_id: string | null; description: string; unit: string | null; quantity: number; unit_price: number | null; discount_pct: number; vat_rate: number; account_id: string; net: number }[]): SaleLineValue[] {
  return lines.map(line => ({
    item_id: line.item_id, description: line.description, unit: line.unit, account_id: line.account_id, vat_rate: Number(line.vat_rate),
    quantity: formatQuantity(line.unit_price === null ? 1 : line.quantity).replace(/,/g, ""), unit_price: priceInput(line.unit_price ?? line.net),
    discount_pct: Number(line.discount_pct) ? String(Number(line.discount_pct)) : "",
  }));
}
