import "server-only";

import type { ReactNode } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";

import type { getDocumentForPdf } from "@/lib/data/sales";
import type { StatementData, StatementLine } from "@/lib/data/statements";
import type { RemittanceData } from "@/lib/data/remittance";
import { AGEING_BUCKETS, type AgeingBucketKey } from "@/lib/domain/billing";
import { countryName } from "@/lib/domain/countries";
import { formatIban } from "@/lib/domain/iban";
import type { OrganisationRow } from "@/types/database";
import { makePdf } from "./pdf-fonts";
import { treatmentNote } from "./document-text";
import { caps, documentWords, type DocumentWords, type WordKey } from "./document-words";
import { DEFAULT_STYLE, onAccent, type DocumentStyle, type StyledDocument } from "./style";

/**
 * The documents a company sends, as PDFs in its name and in its style
 * (./style): invoices, quotes and credit notes in one layout, because an
 * accepted quote becomes an invoice and a credit note reverses one with the
 * very same lines; statements of account with a customer or a supplier; and
 * remittance advice for what was paid to a supplier.
 */

export type DocumentPdfData = NonNullable<Awaited<ReturnType<typeof getDocumentForPdf>>>;

const INK = "#1d2433", MUTED = "#5b6474", FAINT = "#8a93a3", LINE = "#d9dde5", WASH = "#f3f5f9", STAMP = "#a33a3a";
const LOGO_BOX = { small: { maxHeight: 36, maxWidth: 130 }, medium: { maxHeight: 54, maxWidth: 190 }, large: { maxHeight: 80, maxWidth: 260 } } as const;

/** A style made into what a page needs: its sheet, colours and type size. */
function lookOf(style: DocumentStyle) {
  const scale = style.size === "small" ? 0.92 : style.size === "large" ? 1.1 : 1;
  const z = (size: number) => Math.round(size * scale * 100) / 100;
  const plain = style.layout === "plain", modern = style.layout === "modern";
  // The plain layout is black on white: it prints the same on any printer.
  const accent = plain ? INK : style.accent, on = plain ? "#ffffff" : onAccent(style.accent);
  const cell = { flexDirection: "row" as const, paddingVertical: 6, paddingHorizontal: 8 };
  const s = StyleSheet.create({
    // Headed paper has its own heading at the top: the page starts below it.
    page: { fontFamily: style.font === "serif" ? "Serif" : "Roboto", fontSize: z(9.5), color: INK, paddingTop: style.letterhead ? 128 : modern ? 52 : 42, paddingBottom: 64, paddingHorizontal: 48 },
    band: { position: "absolute", top: 0, left: 0, right: 0, height: 12, backgroundColor: accent },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 24 },
    brandName: { fontSize: z(17), fontWeight: 500, letterSpacing: 0.2 },
    titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: style.letterhead ? 0 : 34, paddingBottom: 10,
      borderBottomWidth: modern ? 0 : plain ? 1 : 1.5, borderBottomColor: accent },
    title: { fontSize: z(22), fontWeight: 500, letterSpacing: 1.5, color: accent },
    stamp: { fontSize: z(11), fontWeight: 500, color: STAMP, letterSpacing: 1 },
    subtitle: { fontSize: z(10), fontWeight: 500, color: MUTED, letterSpacing: 0.6 },
    meta: { flexDirection: "row", gap: 18 },
    label: { color: FAINT, fontSize: z(7.5), textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
    metaValue: { fontSize: z(10), fontWeight: 500 },
    parties: { flexDirection: "row", gap: 24, marginTop: 18 },
    party: { flex: 1 },
    partyName: { fontSize: z(11), fontWeight: 500 },
    due: plain ? { width: 180, padding: 10, borderWidth: 0.75, borderColor: INK }
      : modern ? { width: 180, padding: 10, backgroundColor: WASH, borderLeftWidth: 3, borderLeftColor: accent }
      : { width: 180, padding: 10, backgroundColor: WASH, borderRadius: 3 },
    dueAmount: { fontSize: z(15), fontWeight: 500, marginTop: 1 },
    table: { marginTop: 20 },
    headRow: plain ? { ...cell, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: INK }
      : { ...cell, paddingVertical: 5, backgroundColor: modern ? accent : WASH },
    head: { color: modern ? on : plain ? INK : MUTED, fontSize: z(7.5), fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.6 },
    row: { ...cell, borderBottomWidth: 0.75, borderBottomColor: LINE },
    description: { flex: 1, paddingRight: 12 },
    date: { width: z(64) },
    qty: { width: z(50), textAlign: "right" },
    price: { width: z(64), textAlign: "right" },
    disc: { width: z(40), textAlign: "right" },
    rate: { width: z(40), textAlign: "right" },
    amount: { width: z(76), textAlign: "right" },
    totals: { marginTop: 12, marginLeft: "auto", width: z(236) },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 8 },
    grandRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 8, marginTop: 4,
      ...(plain ? { borderTopWidth: 1, borderBottomWidth: 1, borderColor: INK } : modern ? { borderTopWidth: 1.5, borderTopColor: accent, color: accent } : { backgroundColor: accent, color: on }) },
    grand: { fontSize: z(11), fontWeight: 500 },
    block: { marginTop: 26 },
    blockLabel: { fontSize: z(8), fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
    footer: { position: "absolute", left: 48, right: 48, bottom: 28, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: LINE, flexDirection: "row", justifyContent: "space-between", color: FAINT, fontSize: z(7.5) },
    ageing: { flexDirection: "row", marginTop: 18, borderWidth: 0.75, borderColor: plain ? INK : LINE },
    ageCell: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRightWidth: 0.75, borderRightColor: plain ? INK : LINE },
    slip: { marginTop: 30, paddingTop: 12, borderTopWidth: 1, borderTopColor: FAINT, borderStyle: "dashed", flexDirection: "row", gap: 24 },
  });
  return { style, s, z, accent, on, plain, modern };
}
type Look = ReturnType<typeof lookOf>;
/**
 * The look of the document being made. React's context is not there on the
 * server, and PDFs are made one at a time (./pdf-fonts), so the one being
 * made sets it before it is drawn and no other is drawn meanwhile.
 */
let current: Look | null = null;
const currentLook = () => current ?? lookOf(DEFAULT_STYLE);

/**
 * Text with room between its lines, in the style's type size. React-pdf
 * multiplies a line height by the text's own font size, and a line height
 * inherited from the page throws the fixed footer off, so each paragraph
 * states both.
 */
function P({ size = 9.5, style, children }: { size?: number; style?: Styles[string]; children: ReactNode }) {
  const { z } = currentLook();
  return <Text style={[{ fontSize: z(size), lineHeight: 1.4 }, ...(style ? [style] : [])]}>{children}</Text>;
}

function lines(text: string | null | undefined) {
  return (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

// Registration numbers are kept as the company writes them, "HE 395540", or as the bare number. A UK company's is its Companies House number.
const heOf = (org: OrganisationRow) => !org.he_number ? null : org.country === "GB" ? `Company no. ${org.he_number}` : /^HE/i.test(org.he_number) ? org.he_number : `HE ${org.he_number}`;

/** The title of a kind of document: the company's own English for it, or the word. */
function titleOf(kind: StyledDocument, words: DocumentWords, style: DocumentStyle) {
  return words.word(kind, style.titles[kind]);
}

/** The page every document is set on: the style's paper, with a band of colour across the top in the modern layout. */
function StyledPage({ children }: { children: ReactNode }) {
  const { s, style, modern } = currentLook();
  return <Page size={style.paper} style={s.page}>
    {modern && !style.letterhead ? <View style={s.band} fixed /> : null}
    {children}
  </Page>;
}

/** The issuing company across the top: its logo or its name where the style puts it, and what it prints about itself. Headed paper has its own. */
function CompanyHeader({ org, logo, words }: { org: OrganisationRow; logo: string | null; words: DocumentWords }) {
  const { s, style } = currentLook();
  if (style.letterhead) return null;
  // The VAT number is on every document a VAT-registered company sends; the HE number and TIC as the style says.
  // A UK company's UTR is HMRC's business, not its customers': it isn't printed.
  const registration = [org.vat_number ? `${words.word("vatLabel")} ${org.vat_number}` : null,
    style.showRegistration ? heOf(org) : null, style.showRegistration && org.tic && org.country !== "GB" ? `${words.word("ticLabel")} ${org.tic}` : null].filter(Boolean).join(" · ");
  const place = style.logoPlace;
  const align = place === "centre" ? "center" : place === "right" ? "right" : "left";
  const brand = <View style={{ width: place === "centre" ? "100%" : 240, alignItems: place === "centre" ? "center" : place === "right" ? "flex-end" : "flex-start" }}>
    {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an HTML one */}
    {logo ? <Image src={logo} style={{ ...LOGO_BOX[style.logoSize], objectFit: "contain", objectPosition: align }} /> : <Text style={[s.brandName, { textAlign: align }]}>{org.name}</Text>}
    {logo ? <P size={8.5} style={{ color: MUTED, marginTop: 4, textAlign: align }}>{org.name}</P> : null}
    {org.greek_name ? <P size={logo ? 8 : 9} style={{ color: MUTED, marginTop: logo ? 0 : 2, textAlign: align }}>{org.greek_name}</P> : null}
  </View>;
  const details = [...lines(org.address), style.showContact ? org.contact_email : null, registration || null].filter((line): line is string => Boolean(line));
  if (place === "centre") return <View style={{ alignItems: "center" }}>
    {brand}
    {details.length ? <P size={8.5} style={{ color: MUTED, marginTop: 6, textAlign: "center" }}>{details.join(" · ")}</P> : null}
  </View>;
  const company = <View style={{ width: 220 }}>
    {details.map((line, index) => <P key={index} size={8.5} style={{ color: MUTED, textAlign: place === "right" ? "left" : "right" }}>{line}</P>)}
  </View>;
  return <View style={s.header}>{place === "right" ? <>{company}{brand}</> : <>{brand}{company}</>}</View>;
}

/**
 * The title's size: 22pt, as every document had; in both languages smaller, as they were (17pt on an invoice, quote or
 * credit note, 15pt on a statement or remittance, whose titles are longer); and a company's own long title smaller too,
 * so the figures beside it keep their room.
 */
function titleSize(title: string, words: DocumentWords, bilingual: number) {
  return words.language === "en+el" ? bilingual : title.length > 26 ? 16 : 22;
}

/** The title across the page, with what it stamps (paid, void) and its figures beside it. */
function TitleRow({ title, size, stamp, subtitle, children }: { title: string; size: number; stamp?: string | null; subtitle?: string | null; children?: ReactNode }) {
  const { s, z } = currentLook();
  return <View style={s.titleRow}>
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, flexShrink: 1 }}>
      <Text style={[s.title, { fontSize: z(size) }]}>{caps(title)}</Text>
      {stamp ? <Text style={s.stamp}>{stamp}</Text> : null}
      {subtitle ? <Text style={s.subtitle}>{caps(subtitle)}</Text> : null}
    </View>
    <View style={s.meta}>{children}</View>
  </View>;
}

function Meta({ label, value }: { label: string; value: string }) {
  const { s } = currentLook();
  return <View><Text style={s.label}>{label}</Text><Text style={s.metaValue}>{value}</Text></View>;
}

/** The terms or message the company prints at the foot of this kind of document. */
function Terms({ kind, words }: { kind: StyledDocument; words: DocumentWords }) {
  const { s, style } = currentLook();
  const text = style.terms[kind];
  return text ? <View style={s.block} wrap={false}>
    <Text style={s.blockLabel}>{words.label(kind === "remittance" ? "notes" : "terms")}</Text>
    {lines(text).map((line, index) => <P key={index} size={8.5} style={{ color: MUTED }}>{line}</P>)}
  </View> : null;
}

/** Where the company is registered, as its documents must say: Cyprus, or for a UK company the part of the UK its number belongs to. */
function registeredIn(org: OrganisationRow, words: DocumentWords) {
  if (org.country !== "GB") return words.word("registeredInCyprus");
  const number = (org.he_number ?? "").toUpperCase();
  return number.startsWith("SC") ? "Registered in Scotland" : number.startsWith("NI") ? "Registered in Northern Ireland" : "Registered in England and Wales";
}

function Footer({ org, title, words }: { org: OrganisationRow; title: string; words: DocumentWords }) {
  const { s, z } = currentLook();
  const he = heOf(org);
  return <View style={s.footer} fixed>
    <Text style={{ flex: 1, paddingRight: 16, fontSize: z(7.5), lineHeight: 1.4 }}>{[org.name, he ? `${registeredIn(org, words)}, ${he}` : registeredIn(org, words)].join(" · ")}</Text>
    <Text render={({ pageNumber, totalPages }) => `${title} · ${words.pageOf(pageNumber, totalPages)}`} />
  </View>;
}

/** How to pay: by transfer to the company's bank account, quoting what is being paid. */
function HowToPay({ bank, words, reference }: { bank: { name: string; bank_details: string | null }; words: DocumentWords; reference: string | null }) {
  const { s } = currentLook();
  return <View style={s.block} wrap={false}>
    <Text style={s.blockLabel}>{words.label("howToPay")}</Text>
    <P style={{ fontWeight: 500 }}>{words.say("byTransfer", bank.name)}</P>
    {lines(bank.bank_details).map((line, index) => <P key={index}>{line}</P>)}
    <P style={{ color: MUTED, marginTop: 4 }}>{reference ? words.say("useReference", reference) : words.say("quoteInvoices")}</P>
  </View>;
}

/** A slip to cut off and send back with the payment: who is paying, for what, how much, and a space for what they paid. */
function PaymentSlip({ org, customer, rows, amount, bank, words }: {
  org: OrganisationRow; customer: string; rows: [string, string][]; amount: string; bank: { name: string; bank_details: string | null } | null; words: DocumentWords;
}) {
  const { s } = currentLook();
  return <View style={s.slip} wrap={false}>
    <View style={{ flex: 1 }}>
      <Text style={s.blockLabel}>{words.label("paymentAdvice")}</Text>
      <P style={{ fontWeight: 500 }}>{org.name}</P>
      {bank ? <>{lines(bank.bank_details).map((line, index) => <P key={index} size={8.5} style={{ color: MUTED }}>{line}</P>)}</> : null}
    </View>
    <View style={{ width: 230 }}>
      {[[words.word("customer"), customer] as [string, string], ...rows, [words.word("amountDue"), amount] as [string, string]].map(([label, value], index) =>
        <View key={index} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 }}><P size={8.5} style={{ color: MUTED }}>{label}</P><P size={8.5} style={{ fontWeight: 500 }}>{value}</P></View>)}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
        <P size={8.5} style={{ color: MUTED }}>{words.word("enclosed")}</P>
        <View style={{ width: 110, borderBottomWidth: 0.75, borderBottomColor: INK, height: 12 }} />
      </View>
    </View>
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

const TITLES = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note", statement: "Statement", remittance: "Remittance" } as const;

function SalesDocument(data: DocumentPdfData) {
  const { kind, org, document, lines: items, customer, bank, corrects, logo } = data;
  const look = currentLook();
  const { s, style } = look;
  const words = documentWords(data.language);
  // In the document's own currency: an invoice carries one; a quote or credit note is in the company's.
  const currency = ("currency" in document && document.currency) || org.currency;
  const money = (value: number | string) => words.money(value, currency);
  const title = titleOf(kind, words, style);
  const until = "due_on" in document ? document.due_on : "valid_until" in document ? document.valid_until : null;
  const paid = "amount_paid" in document ? Number(document.amount_paid) : 0;
  const credited = "amount_credited" in document ? Number(document.amount_credited) : 0;
  const balance = "balance" in document ? Number(document.balance) : Number(document.total);
  const charged = document.vat_treatment === "standard" && org.vat_registered;
  const itemised = style.itemColumns === "always" || items.some(item => item.unit_price !== null && (Number(item.quantity) !== 1 || Number(item.discount_pct) > 0 || item.item_id));
  const discounted = items.some(item => Number(item.discount_pct) > 0);
  const rated = charged && style.showVatRate;
  const stamp = stampFor(data), note = treatmentNote(data, words);
  const payable = kind === "invoice" && (document.status === "issued" || document.status === "part_paid" || document.status === "draft");
  const vatByRate = [...items.reduce((rates, line) => Number(line.vat_rate) > 0 ? rates.set(Number(line.vat_rate), (rates.get(Number(line.vat_rate)) ?? 0) + Number(line.vat_amount)) : rates, new Map<number, number>())]
    .sort(([a], [b]) => b - a);
  const panel = kind === "quote" ? { label: words.label("quoteTotal"), amount: Number(document.total), note: until ? words.sayShort("validUntilDate", words.date(until)) : null }
    : kind === "credit_note" ? { label: words.label("credit"), amount: Number(document.total), note: corrects ? words.sayShort("againstInvoice", corrects.number) : null }
    : { label: words.label(paid + credited > 0 ? "balanceDue" : "amountDue"), amount: balance, note: until ? words.sayShort("by", words.date(until)) : null };

  return <Document title={`${title} ${document.number}`} author={org.name} subject={customer?.name ?? undefined} creator={org.name} producer={org.name} language={words.lang}>
    <StyledPage>
      <CompanyHeader org={org} logo={logo} words={words} />

      <TitleRow title={title} size={titleSize(title, words, 17)} stamp={stamp ? words.word(stamp) : null}>
        <Meta label={words.label("number")} value={document.number} />
        <Meta label={words.label("date")} value={words.date(document.issued_on)} />
        {until && kind !== "credit_note" ? <Meta label={words.label(kind === "quote" ? "validUntil" : "due")} value={words.date(until)} /> : null}
        {corrects ? <Meta label={words.label("creditsInvoice")} value={corrects.number} /> : null}
        {"reference" in document && document.reference ? <Meta label={words.label("yourReference")} value={document.reference} /> : null}
      </TitleRow>

      <View style={s.parties}>
        <View style={s.party}>
          <Text style={s.label}>{words.label(kind === "quote" ? "preparedFor" : kind === "credit_note" ? "creditedTo" : "billedTo")}</Text>
          <P style={s.partyName}>{customer?.name ?? document.client_name}</P>
          {lines(customer?.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {customer && customer.country !== "CY" ? <P style={{ color: MUTED }}>{countryName(customer.country)}</P> : null}
          {customer?.vat_number ? <P style={{ color: MUTED }}>{words.word("vatLabel")} {customer.vat_number}</P> : null}
        </View>
        <View style={s.due}>
          <Text style={s.label}>{panel.label}</Text>
          <Text style={s.dueAmount}>{money(panel.amount)}</Text>
          {panel.note ? <P size={8.5} style={{ color: MUTED, marginTop: 2 }}>{panel.note}</P> : null}
        </View>
      </View>

      {kind === "credit_note" && "reason" in document ? <P style={{ marginTop: 16, color: MUTED }}>{words.say("reasonLine", document.reason, corrects ? { number: corrects.number, date: words.date(corrects.issued_on) } : null)}</P> : null}

      <View style={s.table}>
        <View style={s.headRow} fixed>
          <Text style={[s.head, s.description]}>{words.label("description")}</Text>
          {itemised ? <Text style={[s.head, s.qty]}>{words.label("qty")}</Text> : null}
          {itemised ? <Text style={[s.head, s.price]}>{words.label("unitPrice")}</Text> : null}
          {discounted ? <Text style={[s.head, s.disc]}>{words.label("disc")}</Text> : null}
          {rated ? <Text style={[s.head, s.rate]}>{words.label("vat")}</Text> : null}
          <Text style={[s.head, s.amount]}>{words.label(charged ? "net" : "amount")}</Text>
        </View>
        {items.map(item => <View key={item.id} style={s.row} wrap={false}>
          <P style={s.description}>{item.description}</P>
          {itemised ? <Text style={s.qty}>{words.quantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</Text> : null}
          {itemised ? <Text style={s.price}>{words.unitPrice(item.unit_price ?? item.net, currency)}</Text> : null}
          {discounted ? <Text style={[s.disc, { color: MUTED }]}>{Number(item.discount_pct) ? `${Number(item.discount_pct)}%` : ""}</Text> : null}
          {rated ? <Text style={[s.rate, { color: MUTED }]}>{Number(item.vat_rate)}%</Text> : null}
          <Text style={s.amount}>{money(item.net)}</Text>
        </View>)}
      </View>

      <View style={s.totals} wrap={false}>
        <View style={s.totalRow}><Text style={{ color: MUTED }}>{words.word("subtotal")}</Text><Text>{money(document.net)}</Text></View>
        {charged ? vatByRate.map(([rate, amount]) => <View key={rate} style={s.totalRow}><Text style={{ color: MUTED }}>{words.sayShort("vatAt", rate)}</Text><Text>{money(amount)}</Text></View>)
          : <View style={s.totalRow}><Text style={{ color: MUTED }}>{words.word("vat")}</Text><Text>{money(0)}</Text></View>}
        <View style={s.grandRow}><Text style={s.grand}>{words.word(kind === "credit_note" ? "totalCredit" : "total")}</Text><Text style={s.grand}>{money(document.total)}</Text></View>
        {kind === "invoice" && (paid > 0 || credited > 0) && document.status !== "void" ? <>
          {paid > 0 ? <View style={s.totalRow}><Text style={{ color: MUTED }}>{words.word("paid")}</Text><Text>−{money(paid)}</Text></View> : null}
          {credited > 0 ? <View style={s.totalRow}><Text style={{ color: MUTED }}>{words.word("credited")}</Text><Text>−{money(credited)}</Text></View> : null}
          <View style={s.totalRow}><Text style={{ fontWeight: 500 }}>{words.word("balanceDue")}</Text><Text style={{ fontWeight: 500 }}>{money(balance)}</Text></View>
        </> : null}
      </View>
      {note ? <P size={8.5} style={{ color: MUTED, marginTop: 10 }}>{note}</P> : null}

      {document.notes ? <View style={s.block} wrap={false}>
        <Text style={s.blockLabel}>{words.label("notes")}</Text>
        {lines(document.notes).map((line, index) => <P key={index}>{line}</P>)}
      </View> : null}

      {payable && bank && style.showPayment ? <HowToPay bank={bank} words={words} reference={document.number} /> : null}
      {kind === "quote" && (document.status === "draft" || document.status === "sent") ? <View style={s.block} wrap={false}>
        <Text style={s.blockLabel}>{words.label("toAccept")}</Text>
        <P>{words.say("replyToAccept", org.contact_email ?? org.name, document.number)}</P>
      </View> : null}
      {kind === "credit_note" ? <View style={s.block} wrap={false}>
        <Text style={s.blockLabel}>{words.label("thisCredit")}</Text>
        <P>{"amount_allocated" in document && Number(document.amount_allocated) > 0 ? words.say("takenOff", money(document.amount_allocated)) : words.say("willBeTakenOff")}
          {"amount_refunded" in document && Number(document.amount_refunded) > 0 ? ` ${words.say("refunded", money(document.amount_refunded))}` : ""}</P>
      </View> : null}

      <Terms kind={kind} words={words} />
      {payable && style.paymentSlip && balance > 0 ? <PaymentSlip org={org} customer={customer?.name ?? document.client_name} words={words} bank={style.showPayment ? bank : null} amount={money(balance)}
        rows={[[words.word("invoice"), document.number], ...(until ? [[words.word("due"), words.date(until)] as [string, string]] : [])]} /> : null}
      <Footer org={org} title={`${title} ${document.number}`} words={words} />
    </StyledPage>
  </Document>;
}

const AGE_WORDS: Record<AgeingBucketKey, WordKey> = { current: "notYetDue", d30: "days1to30", d60: "days31to60", d90: "days61to90", older: "over90" };
const LINE_WORDS: Record<StatementLine["kind"], WordKey> = {
  invoice: "invoice", payment: "payment", credit_note: "credit_note", refund: "refund",
  bill: "bill", bill_payment: "payment", supplier_credit: "credit_note", supplier_refund: "refundReceived",
};

/** What a statement line says: what it is, its number, and what it was against. */
export function statementDetail(line: StatementLine, words: DocumentWords) {
  const against = line.against && line.against !== line.reference ? ` (${line.against})` : "";
  const date = line.due_on && (line.kind === "invoice" || line.kind === "bill") ? words.date(line.due_on) : null;
  const due = !date ? "" : words.language === "en" ? `, due ${date}` : words.language === "el" ? `, λήξη ${date}` : `, λήξη / due ${date}`;
  return `${words.word(LINE_WORDS[line.kind])} ${line.reference}${against}${due}`.trim();
}

/**
 * A statement of account with a customer or a supplier: its activity in a
 * period with the running balance, or its open items on one day; and what is
 * owed by how late it is.
 */
function StatementDocument(data: StatementData) {
  const { org, party, view, account, from, to, opening, lines: rows, closing, open, ageing, overdue, unusedCredit, bank, logo } = data;
  const look = currentLook();
  const { s, style } = look;
  const words = documentWords(data.language);
  const money = (value: number | string) => words.money(value, org.currency);
  const customer = party === "customer";
  const title = titleOf("statement", words, style);
  const balanceLabel = words.label(customer ? "balanceOwed" : "balanceWeOwe");
  return <Document title={`${title} ${account.name}`} author={org.name} subject={account.name} creator={org.name} producer={org.name} language={words.lang}>
    <StyledPage>
      <CompanyHeader org={org} logo={logo} words={words} />
      <TitleRow title={title} size={titleSize(title, words, 15)} subtitle={view === "open" ? words.word("openItems") : null}>
        {view === "activity" ? <>
          <Meta label={words.label("from")} value={words.date(from)} />
          <Meta label={words.label("to")} value={words.date(to)} />
        </> : <Meta label={words.label("asAt")} value={words.date(to)} />}
      </TitleRow>
      <View style={s.parties}>
        <View style={s.party}>
          <Text style={s.label}>{words.label(customer ? "accountOf" : "accountWith")}</Text>
          <P style={s.partyName}>{account.name}</P>
          {lines(account.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {account.country !== org.country ? <P style={{ color: MUTED }}>{countryName(account.country)}</P> : null}
          {account.vat_number ? <P style={{ color: MUTED }}>{words.word("vatLabel")} {account.vat_number}</P> : null}
        </View>
        <View style={s.due}>
          <Text style={s.label}>{balanceLabel}</Text>
          <Text style={s.dueAmount}>{money(closing)}</Text>
          <P size={8.5} style={{ color: overdue > 0 ? STAMP : MUTED, marginTop: 2 }}>{overdue > 0 ? words.sayShort("overdueOf", money(overdue)) : words.word("nothingOverdue")}</P>
        </View>
      </View>

      {view === "activity" ? <View style={s.table}>
        <View style={s.headRow} fixed>
          <Text style={[s.head, s.date]}>{words.label("date")}</Text>
          <Text style={[s.head, s.description]}>{words.label("details")}</Text>
          <Text style={[s.head, s.amount]}>{words.label(customer ? "charged" : "billed")}</Text>
          <Text style={[s.head, s.amount]}>{words.label("paidOrCredited")}</Text>
          <Text style={[s.head, s.amount]}>{words.label("balance")}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.date}>{words.date(from)}</Text>
          <P style={[s.description, { color: MUTED }] as unknown as Styles[string]}>{words.word("broughtForward")}</P>
          <Text style={s.amount} /><Text style={s.amount} />
          <Text style={s.amount}>{money(opening)}</Text>
        </View>
        {rows.map((row, index) => <View key={index} style={s.row} wrap={false}>
          <Text style={s.date}>{words.date(row.date)}</Text>
          <P style={s.description}>{statementDetail(row, words)}</P>
          <Text style={s.amount}>{row.charged ? money(row.charged) : ""}</Text>
          <Text style={s.amount}>{row.settled ? money(row.settled) : ""}</Text>
          <Text style={s.amount}>{money(row.balance)}</Text>
        </View>)}
        <View style={[s.row, { borderBottomWidth: 0 }]}>
          <Text style={s.date}>{words.date(to)}</Text>
          <P style={[s.description, { fontWeight: 500 }] as unknown as Styles[string]}>{words.word(customer ? "balanceOwed" : "balanceWeOwe")}</P>
          <Text style={s.amount} /><Text style={s.amount} />
          <Text style={[s.amount, { fontWeight: 500 }]}>{money(closing)}</Text>
        </View>
      </View> : <View style={s.table}>
        <View style={s.headRow} fixed>
          <Text style={[s.head, s.date]}>{words.label("date")}</Text>
          <Text style={[s.head, s.description]}>{words.label("details")}</Text>
          <Text style={[s.head, s.date]}>{words.label("due")}</Text>
          <Text style={[s.head, s.amount]}>{words.label("original")}</Text>
          <Text style={[s.head, s.amount]}>{words.label("outstanding")}</Text>
        </View>
        {open.length ? open.map(item => <View key={item.id} style={s.row} wrap={false}>
          <Text style={s.date}>{words.date(item.issued_on)}</Text>
          <P style={s.description}>{`${words.word(customer ? "invoice" : "bill")} ${item.number}`}{item.days_overdue > 0 ? <Text style={{ color: STAMP }}>{` · ${words.sayShort("daysOverdue", item.days_overdue)}`}</Text> : null}</P>
          <Text style={s.date}>{item.due_on ? words.date(item.due_on) : ""}</Text>
          <Text style={s.amount}>{money(item.total)}</Text>
          <Text style={s.amount}>{money(item.outstanding)}</Text>
        </View>) : <View style={s.row}><P style={[s.description, { color: MUTED }] as unknown as Styles[string]}>{words.word("nothingOutstanding")}</P></View>}
        {unusedCredit > 0 ? <View style={s.row}>
          <Text style={s.date} />
          <P style={[s.description, { color: MUTED }] as unknown as Styles[string]}>{words.word("creditToUse")}</P>
          <Text style={s.date} /><Text style={s.amount} />
          <Text style={s.amount}>−{money(unusedCredit)}</Text>
        </View> : null}
        <View style={[s.row, { borderBottomWidth: 0 }]}>
          <Text style={s.date} />
          <P style={[s.description, { fontWeight: 500 }] as unknown as Styles[string]}>{words.word(customer ? "balanceOwed" : "balanceWeOwe")}</P>
          <Text style={s.date} /><Text style={s.amount} />
          <Text style={[s.amount, { fontWeight: 500 }]}>{money(closing)}</Text>
        </View>
      </View>}

      <View style={s.ageing} wrap={false}>
        {AGEING_BUCKETS.map((bucket, index) => <View key={bucket.key} style={[s.ageCell, index === AGEING_BUCKETS.length - 1 ? { borderRightWidth: 0 } : {}]}>
          <Text style={s.label}>{words.label(AGE_WORDS[bucket.key])}</Text>
          <Text style={{ fontWeight: 500, color: index > 0 && ageing[bucket.key] > 0 ? STAMP : INK }}>{money(ageing[bucket.key])}</Text>
        </View>)}
      </View>
      {view === "activity" && unusedCredit > 0 ? <P size={8.5} style={{ color: MUTED, marginTop: 8 }}>{words.say(customer ? "creditHeld" : "creditUnused", money(unusedCredit))}</P> : null}

      {customer && closing > 0 && bank && style.showPayment ? <HowToPay bank={bank} words={words} reference={null} /> : null}
      {customer ? <Terms kind="statement" words={words} /> : null}
      {customer && closing > 0 && style.paymentSlip ? <PaymentSlip org={org} customer={account.name} words={words} bank={style.showPayment ? bank : null} amount={money(closing)}
        rows={[[words.word("statementDate"), words.date(to)]]} /> : null}
      <Footer org={org} title={`${title} · ${account.name}`} words={words} />
    </StyledPage>
  </Document>;
}

/** A remittance advice: what was paid to a supplier, on which day, against which of their invoices. */
function RemittanceDocument(data: RemittanceData) {
  const { org, supplier, logo, paidOn, reference, lines: items, total } = data;
  const { s, style } = currentLook();
  const words = documentWords(data.language);
  const money = (value: number | string) => words.money(value, org.currency);
  const title = titleOf("remittance", words, style);
  return <Document title={`${title} ${supplier.name}`} author={org.name} subject={supplier.name} creator={org.name} producer={org.name} language={words.lang}>
    <StyledPage>
      <CompanyHeader org={org} logo={logo} words={words} />
      <TitleRow title={title} size={titleSize(title, words, 15)}>
        <Meta label={words.label("datePaid")} value={words.date(paidOn)} />
        {reference ? <Meta label={words.label("reference")} value={reference} /> : null}
      </TitleRow>
      <View style={s.parties}>
        <View style={s.party}>
          <Text style={s.label}>{words.label("to")}</Text>
          <P style={s.partyName}>{supplier.name}</P>
          {lines(supplier.address).map((line, index) => <P key={index} style={{ color: MUTED }}>{line}</P>)}
          {supplier.vat_number ? <P style={{ color: MUTED }}>{words.word("vatLabel")} {supplier.vat_number}</P> : null}
        </View>
        <View style={s.due}>
          <Text style={s.label}>{words.label("amountPaid")}</Text>
          <Text style={s.dueAmount}>{money(total)}</Text>
          <P size={8.5} style={{ color: MUTED, marginTop: 2 }}>{words.say("paidByTransfer", words.date(paidOn), supplier.iban ? formatIban(supplier.iban) : null)}</P>
        </View>
      </View>
      <View style={s.table}>
        <View style={s.headRow} fixed>
          <Text style={[s.head, s.description]}>{words.label("yourInvoice")}</Text>
          <Text style={[s.head, s.date]}>{words.label("date")}</Text>
          <Text style={[s.head, s.amount]}>{words.label("invoiceTotal")}</Text>
          <Text style={[s.head, s.amount]}>{words.label("paidNow")}</Text>
        </View>
        {items.map(item => <View key={item.id} style={s.row} wrap={false}>
          <P style={s.description}>{item.number ?? "—"}</P>
          <Text style={s.date}>{words.date(item.issued_on)}</Text>
          <Text style={s.amount}>{money(item.total)}</Text>
          <Text style={s.amount}>{money(item.amount)}</Text>
        </View>)}
      </View>
      <View style={s.totals} wrap={false}>
        <View style={s.grandRow}><Text style={s.grand}>{words.word("totalPaid")}</Text><Text style={s.grand}>{money(total)}</Text></View>
      </View>
      <Terms kind="remittance" words={words} />
      <Footer org={org} title={`${title} · ${supplier.name}`} words={words} />
    </StyledPage>
  </Document>;
}

/** A document drawn in its style: the style is the current one until it is done. */
async function styled(style: DocumentStyle, document: Parameters<typeof renderToBuffer>[0]) {
  current = lookOf(style);
  try { return await renderToBuffer(document); }
  finally { current = null; }
}

export async function renderDocumentPdf(data: DocumentPdfData): Promise<Buffer> {
  return makePdf(() => styled(data.style, <SalesDocument {...data} />));
}

export async function renderStatementPdf(data: StatementData): Promise<Buffer> {
  return makePdf(() => styled(data.style, <StatementDocument {...data} />));
}

export async function renderRemittancePdf(data: RemittanceData): Promise<Buffer> {
  return makePdf(() => styled(data.style, <RemittanceDocument {...data} />));
}

/** A file name a mail client and a file system both accept: "Invoice LR-2026-0042.pdf". */
export function documentFileName(kind: keyof typeof TITLES, number: string, extension = "pdf") {
  return `${TITLES[kind]} ${number.replace(/[^A-Za-z0-9 ._-]+/g, "-").replace(/-+/g, "-").trim()}.${extension}`;
}
