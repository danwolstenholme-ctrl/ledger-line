import { formatAmount } from "@/lib/format";
import type { OrganisationRow, VatTreatment } from "@/types/database";

/**
 * What a sales document says the same way on paper (the PDF) and on screen
 * (the page its customer opens from a shared link): its colours, and what it
 * says about the VAT on it.
 */

const INK = "#1d2433";

/** The company's accent for its documents, and the text colour that reads on it. */
export function accentOf(org: Pick<OrganisationRow, "invoice_accent">) {
  const hex = /^#[0-9a-f]{6}$/i.test(org.invoice_accent) ? org.invoice_accent : INK;
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return { accent: hex, onAccent: 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? INK : "#ffffff" };
}

/** Why no VAT was charged, when none was: the words the law asks for. */
export function treatmentNote({ document, org }: { document: { vat_treatment: VatTreatment; net: number | string }; org: Pick<OrganisationRow, "name" | "vat_registered" | "country" | "currency"> }) {
  if (!org.vat_registered) return `${org.name} is not registered for VAT. No VAT has been charged.`;
  if (org.country === "GB") {
    // The CIS domestic reverse charge: the invoice says so, and shows the VAT the customer is to pay HMRC.
    if (document.vat_treatment === "reverse_charge") return `Reverse charge: customer to pay the VAT to HMRC. VAT at 20% on ${formatAmount(document.net, org.currency)}: ${formatAmount(Math.round(Number(document.net) * 20) / 100, org.currency)}.`;
    if (document.vat_treatment === "exempt") return "Exempt from VAT.";
    if (document.vat_treatment === "outside_scope") return "Outside the scope of UK VAT: the place of supply is outside the UK.";
    return null;
  }
  if (document.vat_treatment === "reverse_charge") return "Reverse charge: VAT to be accounted for by the recipient under Article 196 of Council Directive 2006/112/EC.";
  if (document.vat_treatment === "exempt") return "Exempt from VAT.";
  if (document.vat_treatment === "outside_scope") return "Outside the scope of Cyprus VAT: the place of supply is outside Cyprus.";
  return null;
}
