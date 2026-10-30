import { formatAmount, formatDate } from "@/lib/format";

/**
 * The words on a document a customer receives, in the language it is sent
 * in: English, Greek, or both (Greek first, as Cypriot documents carry
 * them: "ΤΙΜΟΛΟΓΙΟ / INVOICE"). Its amounts and dates follow: a Greek
 * document writes 2.266,11 € and 27 Οκτ 2026; a document in both keeps
 * €2,266.11 and writes the date 27/10/2026, which reads the same in each.
 */

export type DocumentLanguage = "en" | "el" | "en+el";
export const DOCUMENT_LANGUAGES: { value: DocumentLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "el", label: "Ελληνικά (Greek)" },
  { value: "en+el", label: "Both: Greek and English" },
];
export const isDocumentLanguage = (value: unknown): value is DocumentLanguage => value === "en" || value === "el" || value === "en+el";

type Pair = { en: string; el: string };
const WORDS = {
  invoice: { en: "Invoice", el: "Τιμολόγιο" },
  quote: { en: "Quote", el: "Προσφορά" },
  credit_note: { en: "Credit note", el: "Πιστωτικό σημείωμα" },
  statement: { en: "Statement", el: "Κατάσταση λογαριασμού" },
  remittance: { en: "Remittance advice", el: "Ειδοποίηση πληρωμής" },
  number: { en: "Number", el: "Αριθμός" },
  date: { en: "Date", el: "Ημερομηνία" },
  due: { en: "Due", el: "Λήξη" },
  validUntil: { en: "Valid until", el: "Ισχύει έως" },
  creditsInvoice: { en: "Credits invoice", el: "Πιστώνει το τιμολόγιο" },
  yourReference: { en: "Your reference", el: "Η αναφορά σας" },
  billedTo: { en: "Billed to", el: "Πελάτης" },
  preparedFor: { en: "Prepared for", el: "Προς" },
  creditedTo: { en: "Credited to", el: "Πίστωση προς" },
  description: { en: "Description", el: "Περιγραφή" },
  qty: { en: "Qty", el: "Ποσ." },
  unitPrice: { en: "Unit price", el: "Τιμή μον." },
  disc: { en: "Disc", el: "Έκπτ." },
  vat: { en: "VAT", el: "ΦΠΑ" },
  net: { en: "Net", el: "Καθαρό" },
  amount: { en: "Amount", el: "Ποσό" },
  subtotal: { en: "Subtotal", el: "Μερικό σύνολο" },
  total: { en: "Total", el: "Σύνολο" },
  totalCredit: { en: "Total credit", el: "Σύνολο πίστωσης" },
  paid: { en: "Paid", el: "Πληρώθηκαν" },
  credited: { en: "Credited", el: "Πιστώθηκαν" },
  balanceDue: { en: "Balance due", el: "Υπόλοιπο πληρωτέο" },
  amountDue: { en: "Amount due", el: "Πληρωτέο ποσό" },
  quoteTotal: { en: "Quote total", el: "Σύνολο προσφοράς" },
  credit: { en: "Credit", el: "Πίστωση" },
  notes: { en: "Notes", el: "Σημειώσεις" },
  howToPay: { en: "How to pay", el: "Τρόπος πληρωμής" },
  toAccept: { en: "To accept", el: "Για αποδοχή" },
  thisCredit: { en: "This credit", el: "Η πίστωση" },
  terms: { en: "Terms", el: "Όροι" },
  paidInFull: { en: "Paid in full", el: "Εξοφλήθηκε πλήρως" },
  paidUp: { en: "Paid", el: "Εξοφλήθηκε" },
  downloadPdf: { en: "Download PDF", el: "Λήψη PDF" },
  reference: { en: "Reference", el: "Αιτιολογία" },
  copy: { en: "Copy", el: "Αντιγραφή" },
  copied: { en: "Copied", el: "Αντιγράφηκε" },
  from: { en: "From", el: "Από" },
  to: { en: "To", el: "Προς" },
  sentWith: { en: "Sent with", el: "Στάλθηκε με" },
  yourName: { en: "Your name", el: "Το όνομά σας" },
  acceptingAs: { en: "As the person accepting it", el: "Του προσώπου που την αποδέχεται" },
  acceptQuote: { en: "Accept this quote", el: "Αποδοχή της προσφοράς" },
  accepting: { en: "Accepting…", el: "Αποδοχή…" },
  goAhead: { en: "Happy to go ahead?", el: "Θέλετε να προχωρήσουμε;" },
  linkGone: { en: "This link can’t be used", el: "Ο σύνδεσμος δεν ισχύει πια" },
  linkGoneDetail: { en: "It was stopped, or the document was withdrawn. Ask whoever sent it to you for a new one.", el: "Σταμάτησε, ή το έγγραφο αποσύρθηκε. Ζητήστε νέο σύνδεσμο από όποιον σας τον έστειλε." },
  dueToday: { en: "Due today", el: "Λήγει σήμερα" },
  withdrawn: { en: "Withdrawn", el: "Ακυρώθηκε" },
  open: { en: "Open", el: "Ανοιχτή" },
  accepted: { en: "Accepted", el: "Εγκρίθηκε" },
  declined: { en: "Declined", el: "Απορρίφθηκε" },
  expired: { en: "Expired", el: "Έληξε" },
  vatLabel: { en: "VAT", el: "Αρ. ΦΠΑ" },
  ticLabel: { en: "TIC", el: "ΑΦΤ" },
  registeredInCyprus: { en: "Registered in Cyprus", el: "Εγγεγραμμένη στην Κύπρο" },
  // A statement of account.
  accountOf: { en: "Account of", el: "Λογαριασμός του" },
  balanceOwed: { en: "Balance owed", el: "Οφειλόμενο υπόλοιπο" },
  nothingOverdue: { en: "Nothing overdue", el: "Τίποτα σε καθυστέρηση" },
  details: { en: "Details", el: "Λεπτομέρειες" },
  charged: { en: "Charged", el: "Χρέωση" },
  paidOrCredited: { en: "Paid or credited", el: "Πληρωμή ή πίστωση" },
  balance: { en: "Balance", el: "Υπόλοιπο" },
  broughtForward: { en: "Brought forward", el: "Από μεταφορά" },
  payment: { en: "Payment", el: "Πληρωμή" },
  refund: { en: "Refund", el: "Επιστροφή" },
  notYetDue: { en: "Not yet due", el: "Δεν έχουν λήξει" },
  days1to30: { en: "1–30 days", el: "1–30 ημέρες" },
  days31to60: { en: "31–60 days", el: "31–60 ημέρες" },
  days61to90: { en: "61–90 days", el: "61–90 ημέρες" },
  over90: { en: "Over 90 days", el: "Πάνω από 90 ημέρες" },
  openItems: { en: "Open items", el: "Ανοιχτά υπόλοιπα" },
  asAt: { en: "As at", el: "Κατά την" },
  original: { en: "Original", el: "Αρχικό ποσό" },
  outstanding: { en: "Outstanding", el: "Ανεξόφλητο" },
  nothingOutstanding: { en: "Nothing outstanding", el: "Τίποτα ανεξόφλητο" },
  creditToUse: { en: "Credit not yet used", el: "Πίστωση προς χρήση" },
  // A supplier's account, as the company keeps it.
  accountWith: { en: "Account with", el: "Λογαριασμός με" },
  balanceWeOwe: { en: "Balance we owe", el: "Υπόλοιπο που οφείλουμε" },
  billed: { en: "Billed", el: "Τιμολογήθηκαν" },
  bill: { en: "Invoice", el: "Τιμολόγιο" },
  refundReceived: { en: "Refund received", el: "Επιστροφή που λάβαμε" },
  // Remittance advice: what was paid to a supplier, and for which of their invoices.
  datePaid: { en: "Date paid", el: "Ημερομηνία πληρωμής" },
  amountPaid: { en: "Amount paid", el: "Ποσό πληρωμής" },
  yourInvoice: { en: "Your invoice", el: "Το τιμολόγιό σας" },
  invoiceTotal: { en: "Invoice total", el: "Σύνολο τιμολογίου" },
  paidNow: { en: "Paid now", el: "Πληρώνεται τώρα" },
  totalPaid: { en: "Total paid", el: "Σύνολο πληρωμής" },
  // The slip a customer cuts off and sends back with the payment.
  paymentAdvice: { en: "Payment advice", el: "Απόκομμα πληρωμής" },
  customer: { en: "Customer", el: "Πελάτης" },
  statementDate: { en: "Statement date", el: "Ημερομηνία κατάστασης" },
  enclosed: { en: "Amount paid", el: "Ποσό που πληρώθηκε" },
  // The words stamped across a document, in capitals.
  PAID: { en: "PAID", el: "ΕΞΟΦΛΗΘΗΚΕ" },
  VOID: { en: "VOID", el: "ΑΚΥΡΩΘΗΚΕ" },
  DRAFT: { en: "DRAFT", el: "ΠΡΟΣΧΕΔΙΟ" },
  CREDITED: { en: "CREDITED", el: "ΠΙΣΤΩΘΗΚΕ" },
  ACCEPTED: { en: "ACCEPTED", el: "ΕΓΚΡΙΘΗΚΕ" },
  DECLINED: { en: "DECLINED", el: "ΑΠΟΡΡΙΦΘΗΚΕ" },
  EXPIRED: { en: "EXPIRED", el: "ΕΛΗΞΕ" },
} satisfies Record<string, Pair>;
export type WordKey = keyof typeof WORDS;

/** Sentences with something in them: an amount, a date, a name. */
const SENTENCES = {
  vatAt: (rate: number) => ({ en: `VAT at ${rate}%`, el: `ΦΠΑ ${rate}%` }),
  by: (date: string) => ({ en: `By ${date}`, el: `Έως ${date}` }),
  validUntilDate: (date: string) => ({ en: `Valid until ${date}`, el: `Ισχύει έως ${date}` }),
  againstInvoice: (number: string) => ({ en: `Against invoice ${number}`, el: `Για το τιμολόγιο ${number}` }),
  byTransfer: (bank: string) => ({ en: `By bank transfer to ${bank}`, el: `Με τραπεζικό έμβασμα στον λογαριασμό ${bank}` }),
  payByTransfer: (bank: string) => ({ en: `Pay by bank transfer to ${bank}`, el: `Πληρωμή με τραπεζικό έμβασμα στον λογαριασμό ${bank}` }),
  useReference: (number: string) => ({ en: `Please use ${number} as the payment reference.`, el: `Παρακαλούμε σημειώστε το ${number} ως αιτιολογία της πληρωμής.` }),
  replyToAccept: (to: string, number: string) => ({ en: `Reply to ${to} quoting ${number}. We will invoice on acceptance.`, el: `Απαντήστε στο ${to} αναφέροντας το ${number}. Θα τιμολογήσουμε με την αποδοχή.` }),
  takenOff: (amount: string) => ({ en: `${amount} has been taken off what you owe.`, el: `${amount} αφαιρέθηκαν από όσα οφείλετε.` }),
  willBeTakenOff: () => ({ en: "It will be taken off what you owe us, or refunded to you.", el: "Θα αφαιρεθεί από όσα μας οφείλετε, ή θα σας επιστραφεί." }),
  refunded: (amount: string) => ({ en: `${amount} has been refunded.`, el: `${amount} σας επιστράφηκαν.` }),
  page: (title: string, page: number, pages: number) => ({ en: `${title} · page ${page} of ${pages}`, el: `${title} · σελίδα ${page} από ${pages}` }),
  registered: (he: string | null) => ({ en: he ? `Registered in Cyprus, ${he}` : "Registered in Cyprus", el: he ? `Εγγεγραμμένη στην Κύπρο, ${he}` : "Εγγεγραμμένη στην Κύπρο" }),
  vatNumber: (number: string) => ({ en: `VAT ${number}`, el: `Αρ. ΦΠΑ ${number}` }),
  overdueOf: (amount: string) => ({ en: `${amount} of it overdue`, el: `${amount} σε καθυστέρηση` }),
  quoteInvoices: () => ({ en: "Please quote the invoice numbers you are paying.", el: "Παρακαλούμε αναφέρετε τους αριθμούς των τιμολογίων που πληρώνετε." }),
  reasonLine: (reason: string, corrects: { number: string; date: string } | null) => ({
    en: `Reason: ${reason}${corrects ? `. This credit note corrects invoice ${corrects.number} of ${corrects.date}.` : "."}`,
    el: `Αιτία: ${reason}${corrects ? `. Το πιστωτικό σημείωμα διορθώνει το τιμολόγιο ${corrects.number} της ${corrects.date}.` : "."}`,
  }),
  creditUnused: (amount: string) => ({ en: `${amount} of credit is still to be used, and is counted in the balance.`, el: `${amount} πίστωσης δεν έχουν χρησιμοποιηθεί ακόμη και υπολογίζονται στο υπόλοιπο.` }),
  paidByTransfer: (date: string, iban: string | null) => ({
    en: `Paid by bank transfer on ${date}${iban ? ` to the account ${iban}` : ""}.`,
    el: `Πληρώθηκε με τραπεζικό έμβασμα στις ${date}${iban ? ` στον λογαριασμό ${iban}` : ""}.`,
  }),
  creditHeld: (amount: string) => ({ en: `${amount} of credit is held for you and has been counted in the balance.`, el: `${amount} πίστωσης κρατούνται για εσάς και έχουν υπολογιστεί στο υπόλοιπο.` }),
  dueOn: (date: string) => ({ en: `, due ${date}`, el: `, λήξη ${date}` }),
  statementOf: (name: string) => ({ en: `Statement · ${name}`, el: `Κατάσταση λογαριασμού · ${name}` }),
  tic: (number: string) => ({ en: `TIC ${number}`, el: `ΑΦΤ ${number}` }),
  forCustomer: (name: string, date: string) => ({ en: `For ${name} · ${date}`, el: `Προς ${name} · ${date}` }),
  daysOverdue: (days: number) => ({ en: `${days} days overdue`, el: `Καθυστέρηση ${days} ημερών` }),
  dueIn: (days: number) => ({ en: `Due in ${days} days`, el: `Λήγει σε ${days} ημέρες` }),
  acceptHere: (company: string) => ({ en: `Accept it here and ${company} will send the invoice.`, el: `Αποδεχτείτε την εδώ, και η ${company} θα στείλει το τιμολόγιο.` }),
  thanks: (company: string) => ({ en: `Accepted. Thank you. ${company} has been told, and will send the invoice.`, el: `Έγινε αποδοχή. Σας ευχαριστούμε. Η ${company} ενημερώθηκε και θα στείλει το τιμολόγιο.` }),
  acceptedBy: (name: string, date: string) => ({ en: `Accepted by ${name} on ${date}.`, el: `Εγκρίθηκε από ${name} στις ${date}.` }),
  notRegistered: (name: string) => ({ en: `${name} is not registered for VAT. No VAT has been charged.`, el: `Η ${name} δεν είναι εγγεγραμμένη στο Μητρώο ΦΠΑ. Δεν χρεώθηκε ΦΠΑ.` }),
  reverseCharge: () => ({ en: "Reverse charge: VAT to be accounted for by the recipient under Article 196 of Council Directive 2006/112/EC.", el: "Αντίστροφη επιβάρυνση: τον ΦΠΑ λογοδοτεί ο λήπτης, σύμφωνα με το άρθρο 196 της Οδηγίας 2006/112/ΕΚ του Συμβουλίου." }),
  exempt: () => ({ en: "Exempt from VAT.", el: "Απαλλάσσεται από τον ΦΠΑ." }),
  outsideScope: () => ({ en: "Outside the scope of Cyprus VAT: the place of supply is outside Cyprus.", el: "Εκτός πεδίου εφαρμογής του ΦΠΑ Κύπρου: ο τόπος παροχής είναι εκτός Κύπρου." }),
};
type Sentences = typeof SENTENCES;

/**
 * What a document says, in its language. A label in both languages joins
 * them ("Ημερομηνία / Date"); a sentence in both is two, Greek first.
 */
/** Capitals as Greek writes them: without their accents (ΤΙΜΟΛΟΓΙΟ, not ΤΙΜΟΛΌΓΙΟ). English is unchanged by it. */
export const caps = (text: string) => text.normalize("NFD").replace(/[\u0301\u0308]/g, "").normalize("NFC").toUpperCase();

export function documentWords(language: DocumentLanguage) {
  const pick = (pair: Pair, sentence = false) => language === "en" ? pair.en : language === "el" ? pair.el : sentence ? `${pair.el}\n${pair.en}` : `${pair.el} / ${pair.en}`;
  return {
    language,
    /** The language for the page's `lang`: Greek when there is any. */
    lang: language === "en" ? "en-GB" : "el",
    /** A word, or a company's own English for it ("Tax invoice" for an invoice's title): Greek keeps its own. */
    word: (key: WordKey, english?: string) => pick(english ? { en: english, el: WORDS[key].el } : WORDS[key]),
    /** A label set in capitals. */
    label: (key: WordKey) => caps(pick(WORDS[key])),
    /** Page numbers at the foot: "page 1 of 2", "σελίδα 1 από 2", or 1/2 where both would crowd it. */
    pageOf: (page: number, pages: number) => language === "en" ? `page ${page} of ${pages}` : language === "el" ? `σελίδα ${page} από ${pages}` : `${page}/${pages}`,
    say: <K extends keyof Sentences>(key: K, ...args: Parameters<Sentences[K]>) => pick((SENTENCES[key] as (...input: Parameters<Sentences[K]>) => Pair)(...args), true),
    /** The short form of a sentence in both languages, for a single line: "Έως 11/11/2026 / By 11/11/2026". */
    sayShort: <K extends keyof Sentences>(key: K, ...args: Parameters<Sentences[K]>) => pick((SENTENCES[key] as (...input: Parameters<Sentences[K]>) => Pair)(...args)),
    /** 20, 1.5, 0.25: in Greek, 1,5. */
    quantity: (value: number | string) => Number(value).toLocaleString(language === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 3 }),
    /** A unit price to the cent, or to four places when it has them. */
    unitPrice: (value: number | string, currency: string) => {
      const number = Number(value);
      const places = Math.round(number * 100) === number * 100 ? 2 : 4;
      return new Intl.NumberFormat(language === "el" ? "el-GR" : "en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: places }).format(number);
    },
    money: (value: number | string, currency: string) => language === "el"
      ? new Intl.NumberFormat("el-GR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
      : formatAmount(value, currency),
    date: (value: string) => language === "en" ? formatDate(value)
      : language === "el" ? new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
      : `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`,
  };
}
export type DocumentWords = ReturnType<typeof documentWords>;
