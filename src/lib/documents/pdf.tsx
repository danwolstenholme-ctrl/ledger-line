import "server-only";

import type { ReactNode } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";

import type { getDocumentForPdf, getStatement } from "@/lib/data/sales";
import { countryName } from "@/lib/domain/countries";
import type { OrganisationRow } from "@/types/database";
import { makePdf } from "./pdf-fonts";
import { accentOf, treatmentNote } from "./document-text";
import { caps, documentWords, type DocumentWords, type WordKey } from "./document-words";

/**
 * The documents a customer receives, as A4 PDFs in the name of the company
 * that issued them: invoices, quotes and credit notes in one layout, because
 * an accepted quote becomes an invoice and a credit note reverses one with
 * the very same lines; and the statement of account.
 */


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

/** The issuing company across the top: its logo or its name, and what it prints about itself. */
function CompanyHeader({ org, logo, words }: { org: OrganisationRow; logo: string | null; words: DocumentWords }) {
  // A UK company's UTR is HMRC's business, not its customers': it isn't printed.
  const registration = [org.vat_number ? `${words.word("vatLabel")} ${org.vat_number}` : null, heOf(org), org.tic && org.country !== "GB" ? `${words.word("ticLabel")} ${org.tic}` : null].filter(Boolean).join(" · ");
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
function Terms({ org, words }: { org: OrganisationRow; words: DocumentWords }) {
  return org.invoice_footer ? <View style={styles.block} wrap={false}>
    <Text style={styles.blockLabel}>{words.label("terms")}</Text>
    {lines(org.invoice_footer).map((line, index) => <P key={index} size={8.5} style={{ color: MUTED }}>{line}</P>)}
  </View> : null;
}

/** Where the company is registered, as its documents must say: Cyprus, or for a UK company the part of the UK its number belongs to. */
function registeredIn(org: OrganisationRow, words: DocumentWords) {
  if (org.country !== "GB") return words.word("registeredInCyprus");
  const number = (org.he_number ?? "").toUpperCase();
  return number.startsWith("SC") ? "Registered in Scotland" : number.startsWith("NI") ? "Registered in Northern Ireland" : "Registered in England and Wales";
}

function Footer({ org, title, words }: { org: OrganisationRow; title: string; words: DocumentWords }) {
  const he = heOf(org);
  return <View style={styles.footer} fixed>
    <P size={7.5} style={{ flex: 1, paddingRight: 16 }}>{[org.name, he ? `${registeredIn(org, words)}, ${he}` : registeredIn(org, words)].join(" · ")}</P>
    <Text render={({ pageNumber, totalPages }) => `${title} · ${words.pageOf(pageNumber, totalPages)}`} />
  </View>;
}

/** The word across the top of a document that is not simply open: paid, void, a draft, accepted. */
function stampFor(data: DocumentPdfData): WordKey | null {
  const { kind, document } = data;
  if (kind === "invoice") {
    if (document.status === "paid" && "amount_credited" in document && Number(document.amount_credited) >= Number(document.total)) return "CREDITED";
    return ({ draft: "DRAFT", void: "VOID", paid: "PAID" } as Record<string, WordKey>)[document.status] ?? null;
  }
  if (kind === "credit_note") return ({ draft: "DRAFT", void: "VOID" } as Record<string, WordKey>)[document.status] ?? null;
  if (document.status === "accepted") return "ACCEPTED";
  if (document.status === "declined") return "DECLINED";
  if ("expired" in document && document.expired) return "EXPIRED";
  return document.status === "draft" ? "DRAFT" : null;
}

const TITLES = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" } as const;

export function SalesDocument(data: DocumentPdfData) {
  const { kind, org, document, lines: items, customer, bank, corrects, logo } = data;
  const words = documentWords(data.language);
  const { accent, onAccent } = accentOf(org);
  // In the document's own currency: an invoice carries one; a quote or credit note is in the company's.
  const currency = ("currency" in document && document.currency) || org.currency;
  const money = (value: number | string) => words.money(value, currency);
  const title = words.word(kind);
  const until = "due_on" in document ? document.due_on : "valid_until" in document ? document.valid_until : null;
  const paid = "amount_paid" in document ? Number(document.amount_paid) : 0;
  const credited = "amount_credited" in document ? Number(document.amount_credited) : 0;
  const balance = "balance" in document ? Number(document.balance) : Number(document.total);
  const charged = document.vat_treatment === "standard" && org.vat_registered;
  const itemised = items.some(item => item.unit_price !== null && (Number(item.quantity) !== 1 || Number(item.discount_pct) > 0 || item.item_id));
  const discounted = items.some(item => Number(item.discount_pct) > 0);
  const stamp = stampFor(data), note = treatmentNote(data, words);
  const payable = kind === "invoice" && (document.status === "issued" || document.status === "part_paid" || document.status === "draft");
  const vatByRate = [...items.reduce((rates, line) => Number(line.vat_rate) > 0 ? rates.set(Number(line.vat_rate), (rates.get(Number(line.vat_rate)) ?? 0) + Number(line.vat_amount)) : rates, new Map<number, number>())]
    .sort(([a], [b]) => b - a);
  const panel = kind === "quote" ? { label: words.label("quoteTotal"), amount: Number(document.total), note: until ? words.sayShort("validUntilDate", words.date(until)) : null }
    : kind === "credit_note" ? { label: words.label("credit"), amount: Number(document.total), note: corrects ? words.sayShort("againstInvoice", corrects.number) : null }
    : { label: words.label(paid + credited > 0 ? "balanceDue" : "amountDue"), amount: balance, note: until ? words.sayShort("by", words.date(until)) : null };

  return <Document title={`${title} ${document.number}`} author={org.name} subject={customer?.name ?? undefined} creator={org.name} producer={org.name} language={words.lang}>
    <Page size="A4" style={styles.page}>
      <CompanyHeader org={org} logo={logo} words={words} />

      <View style={[styles.titleRow, { borderBottomColor: accent }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <Text style={[styles.title, { color: accent }, words.language === "en+el" ? { fontSize: 17 } : {}]}>{caps(title)}</Text>
          {stamp ? <Text style={styles.stamp}>{words.word(stamp)}</Text> : null}
        </View>
        <View style={styles.meta}>
          <View><Text style={styles.label}>{words.label("number")}</Text><Text style={styles.metaValue}>{document.number}</Text></View>
          <View><Text style={styles.label}>{words.label("date")}</Text><Text style={styles.metaValue}>{words.date(document.issued_on)}</Text></View>
          {until && kind !== "credit_note" ? <View><Text style={styles.label}>{words.label(kind === "quote" ? "validUntil" : "due")}</Text><Text style={styles.metaValue}>{words.date(until)}</Text></View> : null}
          {corrects ? <View><Text style={styles.label}>{words.label("creditsInvoice")}</Text><Text style={styles.metaValue}>{corrects.number}</Text></View> : null}
          {"reference" in document && document.reference ? <View><Text style={styles.label}>{words.label("yourReference")}</Text><Text style={styles.metaValue}>{document.reference}</Text></View> : null}
        </View>
      </View>

      <View style={styles.parties}>
        <View style={styles.party}>
          <Text style={styles.label}>{words.label(kind === "quote" ? "preparedFor" : kind === "credit_note" ? "creditedTo" : "billedTo")}</Text>
          <P style={styles.partyName}>{customer?.name ?? document.client_name}</P>
          {lines(customer?.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {customer && customer.country !== "CY" ? <P style={{ color: MUTED }}>{countryName(customer.country)}</P> : null}
          {customer?.vat_number ? <P style={{ color: MUTED }}>{words.word("vatLabel")} {customer.vat_number}</P> : null}
        </View>
        <View style={styles.due}>
          <Text style={styles.label}>{panel.label}</Text>
          <Text style={styles.dueAmount}>{money(panel.amount)}</Text>
          {panel.note ? <P size={8.5} style={{ color: MUTED, marginTop: 2 }}>{panel.note}</P> : null}
        </View>
      </View>

      {kind === "credit_note" && "reason" in document ? <P style={{ marginTop: 16, color: MUTED }}>{words.say("reasonLine", document.reason, corrects ? { number: corrects.number, date: words.date(corrects.issued_on) } : null)}</P> : null}

      <View style={styles.table}>
        <View style={styles.headRow} fixed>
          <Text style={[styles.head, styles.description]}>{words.label("description")}</Text>
          {itemised ? <Text style={[styles.head, styles.qty]}>{words.label("qty")}</Text> : null}
          {itemised ? <Text style={[styles.head, styles.price]}>{words.label("unitPrice")}</Text> : null}
          {discounted ? <Text style={[styles.head, styles.disc]}>{words.label("disc")}</Text> : null}
          {charged ? <Text style={[styles.head, styles.rate]}>{words.label("vat")}</Text> : null}
          <Text style={[styles.head, styles.amount]}>{words.label(charged ? "net" : "amount")}</Text>
        </View>
        {items.map(item => <View key={item.id} style={styles.row} wrap={false}>
          <P style={styles.description}>{item.description}</P>
          {itemised ? <Text style={styles.qty}>{words.quantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</Text> : null}
          {itemised ? <Text style={styles.price}>{words.unitPrice(item.unit_price ?? item.net, currency)}</Text> : null}
          {discounted ? <Text style={[styles.disc, { color: MUTED }]}>{Number(item.discount_pct) ? `${Number(item.discount_pct)}%` : ""}</Text> : null}
          {charged ? <Text style={[styles.rate, { color: MUTED }]}>{Number(item.vat_rate)}%</Text> : null}
          <Text style={styles.amount}>{money(item.net)}</Text>
        </View>)}
      </View>

      <View style={styles.totals} wrap={false}>
        <View style={styles.totalRow}><Text style={{ color: MUTED }}>{words.word("subtotal")}</Text><Text>{money(document.net)}</Text></View>
        {charged ? vatByRate.map(([rate, amount]) => <View key={rate} style={styles.totalRow}><Text style={{ color: MUTED }}>{words.sayShort("vatAt", rate)}</Text><Text>{money(amount)}</Text></View>)
          : <View style={styles.totalRow}><Text style={{ color: MUTED }}>{words.word("vat")}</Text><Text>{money(0)}</Text></View>}
        <View style={[styles.grandRow, { backgroundColor: accent, color: onAccent }]}><Text style={styles.grand}>{words.word(kind === "credit_note" ? "totalCredit" : "total")}</Text><Text style={styles.grand}>{money(document.total)}</Text></View>
        {kind === "invoice" && (paid > 0 || credited > 0) && document.status !== "void" ? <>
          {paid > 0 ? <View style={styles.totalRow}><Text style={{ color: MUTED }}>{words.word("paid")}</Text><Text>−{money(paid)}</Text></View> : null}
          {credited > 0 ? <View style={styles.totalRow}><Text style={{ color: MUTED }}>{words.word("credited")}</Text><Text>−{money(credited)}</Text></View> : null}
          <View style={styles.totalRow}><Text style={{ fontWeight: 500 }}>{words.word("balanceDue")}</Text><Text style={{ fontWeight: 500 }}>{money(balance)}</Text></View>
        </> : null}
      </View>
      {note ? <P size={8.5} style={{ color: MUTED, marginTop: 10 }}>{note}</P> : null}

      {document.notes ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>{words.label("notes")}</Text>
        {lines(document.notes).map((line, index) => <P key={index}>{line}</P>)}
      </View> : null}

      {payable && bank ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>{words.label("howToPay")}</Text>
        <P style={{ fontWeight: 500 }}>{words.say("byTransfer", bank.name)}</P>
        {lines(bank.bank_details).map((line, index) => <P key={index}>{line}</P>)}
        <P style={{ color: MUTED, marginTop: 4 }}>{words.say("useReference", document.number)}</P>
      </View> : null}
      {kind === "quote" && (document.status === "draft" || document.status === "sent") ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>{words.label("toAccept")}</Text>
        <P>{words.say("replyToAccept", org.contact_email ?? org.name, document.number)}</P>
      </View> : null}
      {kind === "credit_note" ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>{words.label("thisCredit")}</Text>
        <P>{"amount_allocated" in document && Number(document.amount_allocated) > 0 ? words.say("takenOff", money(document.amount_allocated)) : words.say("willBeTakenOff")}
          {"amount_refunded" in document && Number(document.amount_refunded) > 0 ? ` ${words.say("refunded", money(document.amount_refunded))}` : ""}</P>
      </View> : null}

      <Terms org={org} words={words} />
      <Footer org={org} title={`${title} ${document.number}`} words={words} />
    </Page>
  </Document>;
}

const AGES = [["current", "notYetDue"], ["1-30", "days1to30"], ["31-60", "days31to60"], ["61-90", "days61to90"], ["90+", "over90"]] as const;

/** A statement of account: the customer's running balance with the company, and what is overdue. */
export function StatementDocument(data: StatementPdfData) {
  const { org, customer, from, to, opening, lines: rows, closing, ageing, unusedCredit, bank, logo } = data;
  const words = documentWords(data.language);
  const { accent } = accentOf(org);
  const money = (value: number | string) => words.money(value, org.currency);
  const overdue = AGES.slice(1).reduce((sum, [key]) => sum + (ageing.get(key) ?? 0), 0);
  const kindLabel = { invoice: words.word("invoice"), payment: words.word("payment"), credit_note: words.word("credit_note"), refund: words.word("refund") } as const;
  const dueNote = (date: string) => words.language === "en" ? `, due ${words.date(date)}` : words.language === "el" ? `, λήξη ${words.date(date)}` : `, λήξη / due ${words.date(date)}`;
  return <Document title={`${words.word("statement")} ${customer.name}`} author={org.name} subject={customer.name} creator={org.name} producer={org.name} language={words.lang}>
    <Page size="A4" style={styles.page}>
      <CompanyHeader org={org} logo={logo} words={words} />
      <View style={[styles.titleRow, { borderBottomColor: accent }]}>
        <Text style={[styles.title, { color: accent }, words.language === "en+el" ? { fontSize: 15 } : {}]}>{caps(words.word("statement"))}</Text>
        <View style={styles.meta}>
          <View><Text style={styles.label}>{words.label("from")}</Text><Text style={styles.metaValue}>{words.date(from)}</Text></View>
          <View><Text style={styles.label}>{words.label("to")}</Text><Text style={styles.metaValue}>{words.date(to)}</Text></View>
        </View>
      </View>
      <View style={styles.parties}>
        <View style={styles.party}>
          <Text style={styles.label}>{words.label("accountOf")}</Text>
          <P style={styles.partyName}>{customer.name}</P>
          {lines(customer.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {customer.vat_number ? <P style={{ color: MUTED }}>{words.word("vatLabel")} {customer.vat_number}</P> : null}
        </View>
        <View style={styles.due}>
          <Text style={styles.label}>{words.label("balanceOwed")}</Text>
          <Text style={styles.dueAmount}>{money(closing)}</Text>
          <P size={8.5} style={{ color: overdue > 0 ? STAMP : MUTED, marginTop: 2 }}>{overdue > 0 ? words.sayShort("overdueOf", money(overdue)) : words.word("nothingOverdue")}</P>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.headRow} fixed>
          <Text style={[styles.head, { width: 64 }]}>{words.label("date")}</Text>
          <Text style={[styles.head, styles.description]}>{words.label("details")}</Text>
          <Text style={[styles.head, styles.amount]}>{words.label("charged")}</Text>
          <Text style={[styles.head, styles.amount]}>{words.label("paidOrCredited")}</Text>
          <Text style={[styles.head, styles.amount]}>{words.label("balance")}</Text>
        </View>
        <View style={styles.row}>
          <Text style={{ width: 64 }}>{words.date(from)}</Text>
          <P style={[styles.description, { color: MUTED }] as unknown as Styles[string]}>{words.word("broughtForward")}</P>
          <Text style={styles.amount} /><Text style={styles.amount} />
          <Text style={styles.amount}>{money(opening)}</Text>
        </View>
        {rows.map((row, index) => <View key={index} style={styles.row} wrap={false}>
          <Text style={{ width: 64 }}>{words.date(row.date)}</Text>
          <P style={styles.description}>{kindLabel[row.kind]} {row.reference}{row.kind === "invoice" && row.due_on ? dueNote(row.due_on) : ""}</P>
          <Text style={styles.amount}>{Number(row.debit) ? money(row.debit) : ""}</Text>
          <Text style={styles.amount}>{Number(row.credit) ? money(row.credit) : ""}</Text>
          <Text style={styles.amount}>{money(row.balance)}</Text>
        </View>)}
        <View style={[styles.row, { borderBottomWidth: 0 }]}>
          <Text style={{ width: 64 }}>{words.date(to)}</Text>
          <P style={[styles.description, { fontWeight: 500 }] as unknown as Styles[string]}>{words.word("balanceOwed")}</P>
          <Text style={styles.amount} /><Text style={styles.amount} />
          <Text style={[styles.amount, { fontWeight: 500 }]}>{money(closing)}</Text>
        </View>
      </View>

      <View style={styles.ageing} wrap={false}>
        {AGES.map(([key, label], index) => <View key={key} style={[styles.ageCell, index === AGES.length - 1 ? { borderRightWidth: 0 } : {}]}>
          <Text style={styles.label}>{words.label(label)}</Text>
          <Text style={{ fontWeight: 500, color: index > 0 && (ageing.get(key) ?? 0) > 0 ? STAMP : INK }}>{money(ageing.get(key) ?? 0)}</Text>
        </View>)}
      </View>
      {unusedCredit > 0 ? <P size={8.5} style={{ color: MUTED, marginTop: 8 }}>{words.say("creditHeld", money(unusedCredit))}</P> : null}

      {closing > 0 && bank ? <View style={styles.block} wrap={false}>
        <Text style={styles.blockLabel}>{words.label("howToPay")}</Text>
        <P style={{ fontWeight: 500 }}>{words.say("byTransfer", bank.name)}</P>
        {lines(bank.bank_details).map((line, index) => <P key={index}>{line}</P>)}
        <P style={{ color: MUTED, marginTop: 4 }}>{words.say("quoteInvoices")}</P>
      </View> : null}
      <Terms org={org} words={words} />
      <Footer org={org} title={`${words.word("statement")} · ${customer.name}`} words={words} />
    </Page>
  </Document>;
}

export async function renderDocumentPdf(data: DocumentPdfData): Promise<Buffer> {
  return makePdf(() => renderToBuffer(<SalesDocument {...data} />));
}

export async function renderStatementPdf(data: StatementPdfData): Promise<Buffer> {
  return makePdf(() => renderToBuffer(<StatementDocument {...data} />));
}

/** A file name a mail client and a file system both accept: "Invoice LR-2026-0042.pdf". */
export function documentFileName(kind: keyof typeof TITLES | "statement", number: string) {
  return `${kind === "statement" ? "Statement" : TITLES[kind]} ${number.replace(/[^A-Za-z0-9 ._-]+/g, "-").replace(/-+/g, "-").trim()}.pdf`;
}
