import { formatAmount } from "@/lib/format";
import type { OrganisationRow, VatTreatment } from "@/types/database";
import { documentWords, type DocumentWords } from "./document-words";
import { onAccent, type DocumentStyle } from "./style";

/**
 * What a sales document says the same way on paper (the PDF) and on screen
 * (the page its customer opens from a shared link): its colours, and what it
 * says about the VAT on it.
 */

const INK = "#1d2433";

/** A document's accent in its style, and the text colour that reads on it. The plain layout has none: ink. */
export function accentOf(style: Pick<DocumentStyle, "accent" | "layout">) {
  const hex = style.layout === "plain" || !/^#[0-9a-f]{6}$/i.test(style.accent) ? INK : style.accent;
  return { accent: hex, onAccent: onAccent(hex) };
}

/** Why no VAT was charged, when none was: the words the law asks for, in the document's language (a UK company's are English). */
export function treatmentNote({ document, org }: { document: { vat_treatment: VatTreatment; net: number | string }; org: Pick<OrganisationRow, "name" | "vat_registered" | "country" | "currency"> },
  words: DocumentWords = documentWords("en")) {
  if (!org.vat_registered) return words.say("notRegistered", org.name);
  if (org.country === "GB") {
    // The CIS domestic reverse charge: the invoice says so, and shows the VAT the customer is to pay HMRC.
    if (document.vat_treatment === "reverse_charge") return `Reverse charge: customer to pay the VAT to HMRC. VAT at 20% on ${formatAmount(document.net, org.currency)}: ${formatAmount(Math.round(Number(document.net) * 20) / 100, org.currency)}.`;
    if (document.vat_treatment === "exempt") return "Exempt from VAT.";
    if (document.vat_treatment === "outside_scope") return "Outside the scope of UK VAT: the place of supply is outside the UK.";
    return null;
  }
  if (document.vat_treatment === "reverse_charge") return words.say("reverseCharge");
  if (document.vat_treatment === "exempt") return words.say("exempt");
  if (document.vat_treatment === "outside_scope") return words.say("outsideScope");
  return null;
}
