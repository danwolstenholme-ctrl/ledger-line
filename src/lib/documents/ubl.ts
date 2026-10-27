import "server-only";

import { ibanIn } from "@/lib/domain/iban";
import type { DocumentPdfData } from "./pdf";

/**
 * An invoice or credit note as a structured e-invoice: UBL 2.1 in the
 * EN 16931 structure of Peppol BIS Billing 3.0, which the EU's VAT in the
 * Digital Age rules build on for intra-EU business sales from July 2030. The
 * figures are the document's own, line by line, exactly as it was posted.
 */

const esc = (value: string | number | null | undefined) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
/** An amount in the document's currency: the company's own. */
const amountIn = (currency: string) => (tag: string, value: number) => `<cbc:${tag} currencyID="${currency}">${money(value)}</cbc:${tag}>`;

/** Electronic address schemes (EAS) for EU VAT numbers, so a Peppol access point can route the document. */
const EAS: Record<string, string> = {
  AT: "9914", BE: "9925", BG: "9926", CY: "9928", CZ: "9929", DE: "9930", EE: "9931", GR: "9933", EL: "9933", HR: "9934", IE: "9935", LT: "9937",
  LU: "9938", LV: "9939", MT: "9943", NL: "9944", PL: "9945", PT: "9946", RO: "9947", SI: "9949", SK: "9950", FR: "9957", HU: "9910", ES: "9920",
};

/** UN/ECE Recommendation 20 and 21 unit codes for the units products are sold in. */
const UNITS: Record<string, string> = { hour: "HUR", day: "DAY", kg: "KGM", litre: "LTR", month: "MON", bottle: "XBO", case: "XCS", box: "XBX", person: "IE" };
const unitCode = (unit: string | null) => (unit ? UNITS[unit.toLowerCase()] : undefined) ?? "C62";

/** "41 Ermou Street, 6021 Larnaca" as street, postcode and town; anything else as one street line. */
function address(text: string | null, country: string) {
  const [first, ...rest] = (text ?? "").split(/\r?\n|,\s*/).map(part => part.trim()).filter(Boolean);
  const last = rest.at(-1) ?? "";
  const town = /^(\d{3,5})\s+(.+)$/.exec(last);
  const street = [first, ...rest.slice(0, town ? -1 : undefined)].filter(Boolean).join(", ");
  return `<cac:PostalAddress>${street ? `<cbc:StreetName>${esc(street)}</cbc:StreetName>` : ""}${town ? `<cbc:CityName>${esc(town[2])}</cbc:CityName><cbc:PostalZone>${esc(town[1])}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
}

function party(input: { name: string; vat: string | null; country: string; address: string | null; email: string | null; registration?: string | null }) {
  const vat = input.vat?.replace(/\s+/g, "").toUpperCase() ?? null;
  const scheme = vat ? EAS[vat.slice(0, 2)] ?? EAS[input.country] : undefined;
  return `<cac:Party>${vat && scheme ? `<cbc:EndpointID schemeID="${scheme}">${esc(vat)}</cbc:EndpointID>` : ""}`
    + `<cac:PartyName><cbc:Name>${esc(input.name)}</cbc:Name></cac:PartyName>${address(input.address, input.country)}`
    + (vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "")
    + `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(input.name)}</cbc:RegistrationName>${input.registration ? `<cbc:CompanyID>${esc(input.registration)}</cbc:CompanyID>` : ""}</cac:PartyLegalEntity>`
    + (input.email ? `<cac:Contact><cbc:ElectronicMail>${esc(input.email)}</cbc:ElectronicMail></cac:Contact>` : "") + `</cac:Party>`;
}

/** The VAT category of a line: standard, zero rated, exempt, reverse charge, or outside the scope. */
function category(data: DocumentPdfData, rate: number) {
  const treatment = data.org.vat_registered ? data.document.vat_treatment : "outside_scope";
  if (treatment === "reverse_charge") return { id: "AE", rate: 0, code: "VATEX-EU-AE", reason: "Reverse charge" };
  if (treatment === "exempt") return { id: "E", rate: 0, code: null, reason: "Exempt from VAT" };
  if (treatment === "outside_scope") return { id: "O", rate: 0, code: "VATEX-EU-O", reason: data.org.vat_registered ? `Outside the scope of ${data.org.country === "GB" ? "UK" : "Cyprus"} VAT` : "The seller is not registered for VAT" };
  return rate > 0 ? { id: "S", rate, code: null, reason: null } : { id: "Z", rate: 0, code: null, reason: null };
}
const taxCategory = (tag: "TaxCategory" | "ClassifiedTaxCategory", item: ReturnType<typeof category>, withReason: boolean) =>
  `<cac:${tag}><cbc:ID>${item.id}</cbc:ID>${item.id === "O" ? "" : `<cbc:Percent>${item.rate}</cbc:Percent>`}`
  + (withReason && item.code ? `<cbc:TaxExemptionReasonCode>${item.code}</cbc:TaxExemptionReasonCode>` : "")
  + (withReason && item.reason ? `<cbc:TaxExemptionReason>${esc(item.reason)}</cbc:TaxExemptionReason>` : "")
  + `<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:${tag}>`;

export function documentUbl(data: DocumentPdfData) {
  const { kind, org, document, lines, customer, bank, corrects } = data;
  if (kind === "quote") throw new Error("A quote is not an e-invoice.");
  const currency = ("currency" in document && document.currency) || org.currency, amount = amountIn(currency);
  const credit = kind === "credit_note";
  const root = credit ? "CreditNote" : "Invoice";
  const lineTag = credit ? "CreditNoteLine" : "InvoiceLine", quantityTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const due = "due_on" in document ? document.due_on : null;
  const paid = "amount_paid" in document ? Number(document.amount_paid) + Number(document.amount_credited ?? 0) : 0;
  const iban = ibanIn(bank?.bank_details);
  // Not subject to VAT (category O): neither party's VAT number may be on it.
  const outside = category(data, 0).id === "O";
  const buyerReference = ("reference" in document && document.reference) ? document.reference : document.number;

  // VAT by category and rate, from the lines as posted.
  const groups = new Map<string, { item: ReturnType<typeof category>; taxable: number; tax: number }>();
  for (const line of lines) {
    const item = category(data, Number(line.vat_rate));
    const key = `${item.id}-${item.rate}`;
    const group = groups.get(key) ?? { item, taxable: 0, tax: 0 };
    group.taxable += Number(line.net); group.tax += item.id === "S" ? Number(line.vat_amount) : 0;
    groups.set(key, group);
  }
  const net = lines.reduce((sum, line) => sum + Number(line.net), 0), tax = [...groups.values()].reduce((sum, group) => sum + group.tax, 0);

  const body = [
    `<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>`,
    `<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>`,
    `<cbc:ID>${esc(document.number)}</cbc:ID>`,
    `<cbc:IssueDate>${document.issued_on}</cbc:IssueDate>`,
    !credit && due ? `<cbc:DueDate>${due}</cbc:DueDate>` : "",
    credit ? `<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>` : `<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`,
    document.notes ? `<cbc:Note>${esc(document.notes)}</cbc:Note>` : "",
    credit && "reason" in document ? `<cbc:Note>${esc(`Reason: ${document.reason}`)}</cbc:Note>` : "",
    `<cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>`,
    `<cbc:BuyerReference>${esc(buyerReference)}</cbc:BuyerReference>`,
    corrects ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(corrects.number)}</cbc:ID><cbc:IssueDate>${corrects.issued_on}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>` : "",
    `<cac:AccountingSupplierParty>${party({ name: org.name, vat: org.vat_registered && !outside ? org.vat_number : null, country: org.country, address: org.address, email: org.contact_email, registration: org.he_number })}</cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty>${party({ name: customer?.name ?? document.client_name, vat: outside ? null : customer?.vat_number ?? null, country: customer?.country ?? org.country, address: customer?.address ?? null, email: customer?.email ?? null })}</cac:AccountingCustomerParty>`,
    !credit && iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode name="Credit transfer">58</cbc:PaymentMeansCode><cbc:PaymentID>${esc(document.number)}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${esc(iban)}</cbc:ID>${bank ? `<cbc:Name>${esc(bank.name)}</cbc:Name>` : ""}</cac:PayeeFinancialAccount></cac:PaymentMeans>` : "",
    !credit && due ? `<cac:PaymentTerms><cbc:Note>${esc(`Due ${due}`)}</cbc:Note></cac:PaymentTerms>` : "",
    `<cac:TaxTotal>${amount("TaxAmount", tax)}${[...groups.values()].map(group => `<cac:TaxSubtotal>${amount("TaxableAmount", group.taxable)}${amount("TaxAmount", group.tax)}${taxCategory("TaxCategory", group.item, true)}</cac:TaxSubtotal>`).join("")}</cac:TaxTotal>`,
    `<cac:LegalMonetaryTotal>${amount("LineExtensionAmount", net)}${amount("TaxExclusiveAmount", net)}${amount("TaxInclusiveAmount", net + tax)}${!credit && paid > 0 ? amount("PrepaidAmount", paid) : ""}${amount("PayableAmount", net + tax - (!credit ? paid : 0))}</cac:LegalMonetaryTotal>`,
    ...lines.map((line, index) => {
      const quantity = line.unit_price === null ? 1 : Number(line.quantity);
      const price = line.unit_price === null ? Number(line.net) : Number(line.unit_price);
      const gross = Math.round(quantity * price * 100) / 100, discount = Math.round((gross - Number(line.net)) * 100) / 100;
      return `<cac:${lineTag}><cbc:ID>${index + 1}</cbc:ID><cbc:${quantityTag} unitCode="${unitCode(line.unit)}">${Number(quantity.toFixed(3))}</cbc:${quantityTag}>${amount("LineExtensionAmount", Number(line.net))}`
        + (discount > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode><cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason><cbc:MultiplierFactorNumeric>${Number(line.discount_pct)}</cbc:MultiplierFactorNumeric>${amount("Amount", discount)}${amount("BaseAmount", gross)}</cac:AllowanceCharge>` : "")
        + `<cac:Item><cbc:Name>${esc(line.description)}</cbc:Name>${taxCategory("ClassifiedTaxCategory", category(data, Number(line.vat_rate)), false)}</cac:Item>`
        + `<cac:Price><cbc:PriceAmount currencyID="${currency}">${Number(price.toFixed(4))}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`;
    }),
  ].filter(Boolean).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">\n  ${body}\n</${root}>\n`;
}
