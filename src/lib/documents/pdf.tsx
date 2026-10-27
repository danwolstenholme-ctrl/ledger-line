import "server-only";

import type { ReactNode } from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";

import type { getDocumentForPdf, getStatement } from "@/lib/data/sales";
import { countryName } from "@/lib/domain/countries";
import { formatQuantity, formatUnitPrice } from "@/lib/domain/line-math";
import { formatAmount, formatDate } from "@/lib/format";
import type { OrganisationRow } from "@/types/database";
import { ROBOTO_MEDIUM, ROBOTO_REGULAR } from "./fonts";
import { accentOf, treatmentNote } from "./document-text";

/**
 * The documents a customer receives, as A4 PDFs in the name of the company
 * that issued them: invoices, quotes and credit notes in one layout, because
 * an accepted quote becomes an invoice and a credit note reverses one with
 * the very same lines; and the statement of account.
 */

Font.register({ family: "Roboto", fonts: [{ src: ROBOTO_REGULAR, fontWeight: 400 }, { src: ROBOTO_MEDIUM, fontWeight: 500 }] });
// A company name is never broken across lines with a hyphen.
Font.registerHyphenationCallback(word => [word]);

export type DocumentPdfData = NonNullable<Awaited<ReturnType<typeof getDocumentForPdf>>>;
export type StatementPdfData = NonNullable<Awaited<ReturnType<typeof getStatement>>>;

const INK = "#1d2433", MUTED = "#5b6474", FAINT = "#8a93a3", LINE = "#d9dde5", WASH = "#f3f5f9", STAMP = "#a33a3a";

const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9.5, color: INK, paddingTop: 42, paddingBottom: 64, paddingHorizontal: 48 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { width: 240 },
  brandName: { fontSize: 17, fontWeight: 500, letterSpacing: 0.2 },
  company: { width: 220, textAlign: "right", color: MUTED },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 34, paddingBottom: 10, borderBottomWidth: 1.5, borderBottomColor: INK },
  title: { fontSize: 22, fontWeight: 500, letterSpacing: 1.5 },
  stamp: { fontSize: 11, fontWeight: 500, color: STAMP, letterSpacing: 1 },
  meta: { flexDirection: "row", gap: 18 },
  label: { color: FAINT, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  metaValue: { fontSize: 10, fontWeight: 500 },
  parties: { flexDirection: "row", gap: 24, marginTop: 18 },
  party: { flex: 1 },
  partyName: { fontSize: 11, fontWeight: 500 },
  due: { width: 180, padding: 10, backgroundColor: WASH, borderRadius: 3 },
  dueAmount: { fontSize: 15, fontWeight: 500, marginTop: 1 },
  table: { marginTop: 20 },
  headRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 8, backgroundColor: WASH },
  row: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 0.75, borderBottomColor: LINE },
  head: { color: MUTED, fontSize: 7.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.6 },
  description: { flex: 1, paddingRight: 12 },
  qty: { width: 50, textAlign: "right" },
  price: { width: 64, textAlign: "right" },
  disc: { width: 40, textAlign: "right" },
  rate: { width: 40, textAlign: "right" },
  amount: { width: 76, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 236 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 8 },
  grandRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 8, marginTop: 4, backgroundColor: INK, color: "#ffffff" },
  grand: { fontSize: 11, fontWeight: 500 },
  block: { marginTop: 26 },
  blockLabel: { fontSize: 8, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  footer: { position: "absolute", left: 48, right: 48, bottom: 28, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: LINE, flexDirection: "row", justifyContent: "space-between", color: FAINT, fontSize: 7.5 },
  ageing: { flexDirection: "row", marginTop: 18, borderWidth: 0.75, borderColor: LINE },
  ageCell: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRightWidth: 0.75, borderRightColor: LINE },
});

/**
 * Text with room between its lines. React-pdf multiplies a line height by the
 * text's own font size, and a line height inherited from the page throws the
 * fixed footer off, so each paragraph states both.
 */
function P({ size = 9.5, style, children }: { size?: number; style?: Styles[string]; children: ReactNode }) {
  return <Text style={[{ fontSize: size, lineHeight: 1.4 }, ...(style ? [style] : [])]}>{children}</Text>;
}

function lines(text: string | null | undefined) {
  return (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

// Registration numbers are kept as the company writes them, "HE 395540", or as the bare number. A UK company's is its Companies House number.
const heOf = (org: OrganisationRow) => !org.he_number ? null : org.country === "GB" ? `Company no. ${org.he_number}` : /^HE/i.test(org.he_number) ? org.he_number : `HE ${org.he_number}`;

/** The company's own colour, and a text colour that reads on it: dark on a light accent, white on a dark one. */
/** The issuing company across the top: its logo or its name, and what it prints about itself. */
function CompanyHeader({ org, logo }: { org: OrganisationRow; logo: string | null }) {
  // A UK company's UTR is HMRC's business, not its customers': it isn't printed.
  const registration = [org.vat_number ? `VAT ${org.vat_number}` : null, heOf(org), org.tic && org.country !== "GB" ? `TIC ${org.tic}` : null].filter(Boolean).join(" · ");
  return <View style={styles.header}>
    <View style={styles.brand}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an HTML one */}
      {logo ? <Image src={logo} style={{ maxHeight: 54, maxWidth: 190, objectFit: "contain", objectPosition: "left" }} /> : <Text style={styles.brandName}>{org.name}</Text>}
      {logo ? <P size={8.5} style={{ color: MUTED, marginTop: 4 }}>{org.name}</P> : null}
      {org.greek_name ? <P size={logo ? 8 : 9} style={{ color: MUTED, marginTop: logo ? 0 : 2 }}>{org.greek_name}</P> : null}
    </View>
    <View style={styles.company}>
      {lines(org.address).map((line, index) => <P key={index} size={8.5}>{line}</P>)}
      {org.contact_email ? <P size={8.5}>{org.contact_email}</P> : null}
      {registration ? <P size={8.5}>{registration}</P> : null}
    </View>
  </View>;
}

/** The company's own terms, printed at the foot of every document it sends. */
function Terms({ org }: { org: OrganisationRow }) {
  return org.invoice_footer ? <View style={styles.block} wrap={false}>
    <Text style={styles.blockLabel}>Terms</Text>
    {lines(org.invoice_footer).map((line, index) => <P key={index} size={8.5} style={{ color: MUTED }}>{line}</P>)}
  </View> : null;
}

function Footer({ org, title }: { org: OrganisationRow; title: string }) {
  const he = heOf(org);
  return <View style={styles.footer} fixed>
    <P size={7.5} style={{ flex: 1, paddingRight: 16 }}>{[org.name, he ? `Registered in Cyprus, ${he}` : "Registered in Cyprus"].join(" · ")}</P>
    <Text render={({ pageNumber, totalPages }) => `${title} · page ${pageNumber} of ${totalPages}`} />
  </View>;
}

/** What the document says about VAT when it charges none. */
function stampFor(data: DocumentPdfData) {
  const { kind, document } = data;
  if (kind === "invoice") {
    if (document.status === "paid" && "amount_credited" in document && Number(document.amount_credited) >= Number(document.total)) return "CREDITED";
    return ({ draft: "DRAFT", void: "VOID", paid: "PAID" } as Record<string, string>)[document.status] ?? null;
  }
  if (kind === "credit_note") return ({ draft: "DRAFT", void: "VOID" } as Record<string, string>)[document.status] ?? null;
  if (document.status === "accepted") return "ACCEPTED";
  if (document.status === "declined") return "DECLINED";
  if ("expired" in document && document.expired) return "EXPIRED";
  return document.status === "draft" ? "DRAFT" : null;
}

const TITLES = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" } as const;

export function SalesDocument(data: DocumentPdfData) {
  const { kind, org, document, lines: items, customer, bank, corrects, logo } = data;
  const { accent, onAccent } = accentOf(org);
  // In the document's own currency: an invoice carries one; a quote or credit note is in the company's.
  const money = (value: number | string) => formatAmount(value, ("currency" in document && document.currency) || org.currency);
  const title = TITLES[kind];
  const until = "due_on" in document ? document.due_on : "valid_until" in document ? document.valid_until : null;
  const paid = "amount_paid" in document ? Number(document.amount_paid) : 0;
  const credited = "amount_credited" in document ? Number(document.amount_credited) : 0;
  const balance = "balance" in document ? Number(document.balance) : Number(document.total);
  const charged = document.vat_treatment === "standard" && org.vat_registered;
  const itemised = items.some(item => item.unit_price !== null && (Number(item.quantity) !== 1 || Number(item.discount_pct) > 0 || item.item_id));
  const discounted = items.some(item => Number(item.discount_pct) > 0);
  const stamp = stampFor(data), note = treatmentNote(data);
  const payable = kind === "invoice" && (document.status === "issued" || document.status === "part_paid" || document.status === "draft");
  const vatByRate = [...items.reduce((rates, line) => Number(line.vat_rate) > 0 ? rates.set(Number(line.vat_rate), (rates.get(Number(line.vat_rate)) ?? 0) + Number(line.vat_amount)) : rates, new Map<number, number>())]
    .sort(([a], [b]) => b - a);
  const panel = kind === "quote" ? { label: "Quote total", amount: Number(document.total), note: until ? `Valid until ${formatDate(until)}` : null }
    : kind === "credit_note" ? { label: "Credit", amount: Number(document.total), note: corrects ? `Against invoice ${corrects.number}` : null }
    : { label: paid + credited > 0 ? "Balance due" : "Amount due", amount: balance, note: until ? `By ${formatDate(until)}` : null };

  return <Document title={`${title} ${document.number}`} author={org.name} subject={customer?.name ?? undefined} creator={org.name} producer={org.name}>
    <Page size="A4" style={styles.page}>
      <CompanyHeader org={org} logo={logo} />

      <View style={[styles.titleRow, { borderBottomColor: accent }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <Text style={[styles.title, { color: accent }]}>{title.toUpperCase()}</Text>
          {stamp ? <Text style={styles.stamp}>{stamp}</Text> : null}
        </View>
        <View style={styles.meta}>
          <View><Text style={styles.label}>Number</Text><Text style={styles.metaValue}>{document.number}</Text></View>
          <View><Text style={styles.label}>Date</Text><Text style={styles.metaValue}>{formatDate(document.issued_on)}</Text></View>
          {until && kind !== "credit_note" ? <View><Text style={styles.label}>{kind === "quote" ? "Valid until" : "Due"}</Text><Text style={styles.metaValue}>{formatDate(until)}</Text></View> : null}
          {corrects ? <View><Text style={styles.label}>Credits invoice</Text><Text style={styles.metaValue}>{corrects.number}</Text></View> : null}
          {"reference" in document && document.reference ? <View><Text style={styles.label}>Your reference</Text><Text style={styles.metaValue}>{document.reference}</Text></View> : null}
        </View>
      </View>

      <View style={styles.parties}>
        <View style={styles.party}>
          <Text style={styles.label}>{kind === "quote" ? "Prepared for" : kind === "credit_note" ? "Credited to" : "Billed to"}</Text>
          <P style={styles.partyName}>{customer?.name ?? document.client_name}</P>
          {lines(customer?.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {customer && customer.country !== "CY" ? <P style={{ color: MUTED }}>{countryName(customer.country)}</P> : null}
          {customer?.vat_number ? <P style={{ color: MUTED }}>VAT {customer.vat_number}</P> : null}
        </View>
        <View style={styles.due}>
          <Text style={styles.label}>{panel.label}</Text>
          <Text style={styles.dueAmount}>{money(panel.amount)}</Text>
          {panel.note ? <P size={8.5} style={{ color: MUTED, marginTop: 2 }}>{panel.note}</P> : null}
        </View>
      </View>

      {kind === "credit_note" && "reason" in document ? <P style={{ marginTop: 16, color: MUTED }}>Reason: {document.reason}{corrects ? `. This credit note corrects invoice ${corrects.number} of ${formatDate(corrects.issued_on)}.` : "."}</P> : null}

      <View style={styles.table}>
        <View style={styles.headRow} fixed>
          <Text style={[styles.head, styles.description]}>Description</Text>
          {itemised ? <Text style={[styles.head, styles.qty]}>Qty</Text> : null}
          {itemised ? <Text style={[styles.head, styles.price]}>Unit price</Text> : null}
          {discounted ? <Text style={[styles.head, styles.disc]}>Disc</Text> : null}
          {charged ? <Text style={[styles.head, styles.rate]}>VAT</Text> : null}
          <Text style={[styles.head, styles.amount]}>{charged ? "Net" : "Amount"}</Text>
        </View>
        {items.map(item => <View key={item.id} style={styles.row} wrap={false}>
          <P style={styles.description}>{item.description}</P>
          {itemised ? <Text style={styles.qty}>{formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</Text> : null}
          {itemised ? <Text style={styles.price}>{formatUnitPrice(item.unit_price ?? item.net)}</Text> : null}
          {discounted ? <Text style={[styles.disc, { color: MUTED }]}>{Number(item.discount_pct) ? `${Number(item.discount_pct)}%` : ""}</Text> : null}
          {charged ? <Text style={[styles.rate, { color: MUTED }]}>{Number(item.vat_rate)}%</Text> : null}
          <Text style={styles.amount}>{money(item.net)}</Text>
        </View>)}
      </View>

      <View style={styles.totals} wrap={false}>
        <View style={styles.totalRow}><Text style={{ color: MUTED }}>Subtotal</Text><Text>{money(document.net)}</Text></View>
        {charged ? vatByRate.map(([rate, amount]) => <View key={rate} style={styles.totalRow}><Text style={{ color: MUTED }}>VAT at {rate}%</Text><Text>{money(amount)}</Text></View>)
          : <View style={styles.totalRow}><Text style={{ color: MUTED }}>VAT</Text><Text>{money(0)}</Text></View>}
        <View style={[styles.grandRow, { backgroundColor: accent, color: onAccent }]}><Text style={styles.grand}>{kind === "credit_note" ? "Total credit" : "Total"}</Text><Text style={styles.grand}>{money(document.total)}</Text></View>
        {kind === "invoice" && (paid > 0 || credited > 0) && document.status !== "void" ? <>
          {paid > 0 ? <View style={styles.totalRow}><Text style={{ color: MUTED }}>Paid</Text><Text>−{money(paid)}</Text></View> : null}
          {credited > 0 ? <View style={styles.totalRow}><Text style={{ color: MUTED }}>Credited</Text><Text>−{money(credited)}</Text></View> : null}
          <View style={styles.totalRow}><Text style={{ fontWeight: 500 }}>Balance due</Text><Text style={{ fontWeight: 500 }}>{money(balance)}</Text></View>
        </> : null}
      </View>
      {note ? <P size={8.5} style={{ color: MUTED, marginTop: 10 }}>{note}</P> : null}

      {document.notes ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>Notes</Text>
        {lines(document.notes).map((line, index) => <P key={index}>{line}</P>)}
      </View> : null}

      {payable && bank ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>How to pay</Text>
        <P style={{ fontWeight: 500 }}>By bank transfer to {bank.name}</P>
        {lines(bank.bank_details).map((line, index) => <P key={index}>{line}</P>)}
        <P style={{ color: MUTED, marginTop: 4 }}>Please use {document.number} as the payment reference.</P>
      </View> : null}
      {kind === "quote" && (document.status === "draft" || document.status === "sent") ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>To accept</Text>
        <P>Reply to {org.contact_email ?? org.name} quoting {document.number}. We will invoice on acceptance.</P>
      </View> : null}
      {kind === "credit_note" ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>This credit</Text>
        <P>{"amount_allocated" in document && Number(document.amount_allocated) > 0 ? `${money(document.amount_allocated)} has been taken off what you owe.` : "It will be taken off what you owe us, or refunded to you."}
          {"amount_refunded" in document && Number(document.amount_refunded) > 0 ? ` ${money(document.amount_refunded)} has been refunded.` : ""}</P>
      </View> : null}

      <Terms org={org} />
      <Footer org={org} title={`${title} ${document.number}`} />
    </Page>
  </Document>;
}

const AGES = [["current", "Not yet due"], ["1-30", "1–30 days"], ["31-60", "31–60 days"], ["61-90", "61–90 days"], ["90+", "Over 90 days"]] as const;

/** A statement of account: the customer's running balance with the company, and what is overdue. */
export function StatementDocument(data: StatementPdfData) {
  const { org, customer, from, to, opening, lines: rows, closing, ageing, unusedCredit, bank, logo } = data;
  const { accent } = accentOf(org);
  const money = (value: number | string) => formatAmount(value, org.currency);
  const overdue = AGES.slice(1).reduce((sum, [key]) => sum + (ageing.get(key) ?? 0), 0);
  const kindLabel = { invoice: "Invoice", payment: "Payment", credit_note: "Credit note", refund: "Refund" } as const;
  return <Document title={`Statement ${customer.name}`} author={org.name} subject={customer.name} creator={org.name} producer={org.name}>
    <Page size="A4" style={styles.page}>
      <CompanyHeader org={org} logo={logo} />
      <View style={[styles.titleRow, { borderBottomColor: accent }]}>
        <Text style={[styles.title, { color: accent }]}>STATEMENT</Text>
        <View style={styles.meta}>
          <View><Text style={styles.label}>From</Text><Text style={styles.metaValue}>{formatDate(from)}</Text></View>
          <View><Text style={styles.label}>To</Text><Text style={styles.metaValue}>{formatDate(to)}</Text></View>
        </View>
      </View>
      <View style={styles.parties}>
        <View style={styles.party}>
          <Text style={styles.label}>Account of</Text>
          <P style={styles.partyName}>{customer.name}</P>
          {lines(customer.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {customer.vat_number ? <P style={{ color: MUTED }}>VAT {customer.vat_number}</P> : null}
        </View>
        <View style={styles.due}>
          <Text style={styles.label}>Balance owed</Text>
          <Text style={styles.dueAmount}>{money(closing)}</Text>
          <P size={8.5} style={{ color: overdue > 0 ? STAMP : MUTED, marginTop: 2 }}>{overdue > 0 ? `${money(overdue)} of it overdue` : "Nothing overdue"}</P>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.headRow} fixed>
          <Text style={[styles.head, { width: 64 }]}>Date</Text>
          <Text style={[styles.head, styles.description]}>Details</Text>
          <Text style={[styles.head, styles.amount]}>Charged</Text>
          <Text style={[styles.head, styles.amount]}>Paid or credited</Text>
          <Text style={[styles.head, styles.amount]}>Balance</Text>
        </View>
        <View style={styles.row}>
          <Text style={{ width: 64 }}>{formatDate(from)}</Text>
          <P style={[styles.description, { color: MUTED }] as unknown as Styles[string]}>Brought forward</P>
          <Text style={styles.amount} /><Text style={styles.amount} />
          <Text style={styles.amount}>{money(opening)}</Text>
        </View>
        {rows.map((row, index) => <View key={index} style={styles.row} wrap={false}>
          <Text style={{ width: 64 }}>{formatDate(row.date)}</Text>
          <P style={styles.description}>{kindLabel[row.kind]} {row.reference}{row.kind === "invoice" && row.due_on ? `, due ${formatDate(row.due_on)}` : ""}</P>
          <Text style={styles.amount}>{Number(row.debit) ? money(row.debit) : ""}</Text>
          <Text style={styles.amount}>{Number(row.credit) ? money(row.credit) : ""}</Text>
          <Text style={styles.amount}>{money(row.balance)}</Text>
        </View>)}
        <View style={[styles.row, { borderBottomWidth: 0 }]}>
          <Text style={{ width: 64 }}>{formatDate(to)}</Text>
          <P style={[styles.description, { fontWeight: 500 }] as unknown as Styles[string]}>Balance owed</P>
          <Text style={styles.amount} /><Text style={styles.amount} />
          <Text style={[styles.amount, { fontWeight: 500 }]}>{money(closing)}</Text>
        </View>
      </View>

      <View style={styles.ageing} wrap={false}>
        {AGES.map(([key, label], index) => <View key={key} style={[styles.ageCell, index === AGES.length - 1 ? { borderRightWidth: 0 } : {}]}>
          <Text style={styles.label}>{label}</Text>
          <Text style={{ fontWeight: 500, color: index > 0 && (ageing.get(key) ?? 0) > 0 ? STAMP : INK }}>{money(ageing.get(key) ?? 0)}</Text>
        </View>)}
      </View>
      {unusedCredit > 0 ? <P size={8.5} style={{ color: MUTED, marginTop: 8 }}>{money(unusedCredit)} of credit is held for you and has been counted in the balance.</P> : null}

      {closing > 0 && bank ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>How to pay</Text>
        <P style={{ fontWeight: 500 }}>By bank transfer to {bank.name}</P>
        {lines(bank.bank_details).map((line, index) => <P key={index}>{line}</P>)}
        <P style={{ color: MUTED, marginTop: 4 }}>Please quote the invoice numbers you are paying.</P>
      </View> : null}
      <Terms org={org} />
      <Footer org={org} title={`Statement · ${customer.name}`} />
    </Page>
  </Document>;
}

export async function renderDocumentPdf(data: DocumentPdfData): Promise<Buffer> {
  return renderToBuffer(<SalesDocument {...data} />);
}

export async function renderStatementPdf(data: StatementPdfData): Promise<Buffer> {
  return renderToBuffer(<StatementDocument {...data} />);
}

/** A file name a mail client and a file system both accept: "Invoice LR-2026-0042.pdf". */
export function documentFileName(kind: keyof typeof TITLES | "statement", number: string) {
  return `${kind === "statement" ? "Statement" : TITLES[kind]} ${number.replace(/[^A-Za-z0-9 ._-]+/g, "-").replace(/-+/g, "-").trim()}.pdf`;
}
