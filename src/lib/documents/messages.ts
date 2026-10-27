import { documentWords, type DocumentLanguage } from "./document-words";

/**
 * The messages that go with a document to its customer, in the customer's
 * language (document_language: English, Greek, or both, Greek first): the
 * invoice by email, a payment reminder, and the words before a shared link.
 * Amounts and dates are written as each language writes them. The person
 * sending reads Ledgerline in their own language; the customer reads this
 * in theirs. Client-safe.
 */

type Bank = { name: string; bank_details: string | null } | null;
type Block = { subject: string; body: string };

/** Each language's message, Greek first when both: one subject, and the bodies one after the other. */
function inEach(language: DocumentLanguage, write: (language: "en" | "el") => Block): Block {
  if (language !== "en+el") return write(language);
  const greek = write("el"), english = write("en");
  return { subject: `${greek.subject} / ${english.subject}`, body: `${greek.body}\n\n— English —\n\n${english.body}` };
}

export type InvoiceEmail = { number: string; company: string; sender: string; greeting: string; balance: number; currency: string; dueOn: string | null; bank: Bank; link?: string | null };

/** The invoice, sent from the person's own email. */
export function invoiceEmail(language: DocumentLanguage, data: InvoiceEmail): Block {
  return inEach(language, lang => {
    const words = documentWords(lang), amount = words.money(data.balance, data.currency), due = data.dueOn ? words.date(data.dueOn) : null;
    if (lang === "el") {
      const bank = data.bank ? `\n\nΜπορείτε να πληρώσετε με τραπεζικό έμβασμα στον λογαριασμό ${data.bank.name}:\n${data.bank.bank_details ?? ""}\nΠαρακαλούμε σημειώστε το ${data.number} ως αιτιολογία.` : "";
      return {
        subject: `Τιμολόγιο ${data.number} από ${data.company}`,
        body: `Αγαπητέ/ή ${data.greeting},\n\n${data.link ? `Σας στέλνουμε το τιμολόγιο ${data.number}` : `Σας επισυνάπτουμε το τιμολόγιο ${data.number}`} ποσού ${amount}${due ? `, πληρωτέο έως ${due}` : ""}.${data.link ? ` Μπορείτε να το δείτε και να το κατεβάσετε εδώ:\n${data.link}` : ""}${bank}\n\nΣας ευχαριστούμε για τη συνεργασία.\n\nΜε εκτίμηση,\n${data.sender}\n${data.company}`,
      };
    }
    const bank = data.bank ? `\n\nYou can pay by bank transfer to ${data.bank.name}:\n${data.bank.bank_details ?? ""}\nPlease quote ${data.number} as the reference.` : "";
    return {
      subject: `Invoice ${data.number} from ${data.company}`,
      body: `Dear ${data.greeting},\n\n${data.link ? `Here is invoice ${data.number}` : `Please find attached invoice ${data.number}`} for ${amount}${due ? `, due by ${due}` : ""}.${data.link ? ` You can view it and download it at:\n${data.link}` : ""}${bank}\n\nThank you for your business.\n\nKind regards,\n${data.sender}\n${data.company}`,
    };
  });
}

export type ReminderEmail = { company: string; sender: string; greeting: string; currency: string; bank: Bank;
  overdue: { number: string; issued_on: string; due_on: string; balance: number; days_overdue: number }[] };

/** A reminder of what is overdue, with the statement attached. */
export function reminderEmail(language: DocumentLanguage, data: ReminderEmail): Block {
  const total = data.overdue.reduce((sum, invoice) => sum + Number(invoice.balance), 0), one = data.overdue.length === 1;
  return inEach(language, lang => {
    const words = documentWords(lang), money = (value: number) => words.money(value, data.currency);
    if (lang === "el") {
      const list = data.overdue.map(invoice => `• ${invoice.number}, ημερομηνίας ${words.date(invoice.issued_on)}: ${money(invoice.balance)}, λήξη ${words.date(invoice.due_on)} (πριν από ${invoice.days_overdue} ${invoice.days_overdue === 1 ? "ημέρα" : "ημέρες"})`).join("\n");
      const bank = data.bank ? `\n\nΜπορείτε να πληρώσετε με τραπεζικό έμβασμα στον λογαριασμό ${data.bank.name}:\n${data.bank.bank_details ?? ""}\nΠαρακαλούμε σημειώστε τους αριθμούς των τιμολογίων ως αιτιολογία.` : "";
      return {
        subject: `${one ? `Τιμολόγιο ${data.overdue[0].number}` : `${data.overdue.length} τιμολόγια`} σε καθυστέρηση · ${data.company}`,
        body: `Αγαπητέ/ή ${data.greeting},\n\nΣύμφωνα με τα αρχεία μας, ${one ? "το παρακάτω τιμολόγιο είναι πλέον ληξιπρόθεσμο" : "τα παρακάτω τιμολόγια είναι πλέον ληξιπρόθεσμα"}:\n\n${list}\n\nΣύνολο σε καθυστέρηση: ${money(total)}. Επισυνάπτεται η κατάσταση λογαριασμού σας.${bank}\n\nΑν έχετε ήδη πληρώσει, σας ευχαριστούμε, και παρακαλούμε αγνοήστε αυτή την υπενθύμιση.\n\nΜε εκτίμηση,\n${data.sender}\n${data.company}`,
      };
    }
    const list = data.overdue.map(invoice => `• ${invoice.number}, dated ${words.date(invoice.issued_on)}: ${money(invoice.balance)}, due ${words.date(invoice.due_on)} (${invoice.days_overdue} days ago)`).join("\n");
    const bank = data.bank ? `\n\nYou can pay by bank transfer to ${data.bank.name}:\n${data.bank.bank_details ?? ""}\nPlease quote the invoice numbers as the reference.` : "";
    return {
      subject: `${one ? `Invoice ${data.overdue[0].number}` : `${data.overdue.length} invoices`} overdue · ${data.company}`,
      body: `Dear ${data.greeting},\n\nOur records show ${one ? "this invoice is" : "these invoices are"} now overdue:\n\n${list}\n\nTotal overdue: ${money(total)}. Your statement is attached.${bank}\n\nIf you have already paid, thank you, and please ignore this reminder.\n\nKind regards,\n${data.sender}\n${data.company}`,
    };
  });
}

export type ShareMessage = { kind: "invoice" | "quote"; number: string; company: string; amount: number; currency: string; date: string | null; paid?: boolean };

/** The words before a document's link in a WhatsApp, Viber, text or email: `subject` for the email. */
export function shareMessage(language: DocumentLanguage, data: ShareMessage): { subject: string; message: string } {
  const block = inEach(language, lang => {
    const words = documentWords(lang), amount = words.money(data.amount, data.currency), date = data.date ? words.date(data.date) : null;
    if (lang === "el") return data.kind === "quote"
      ? { subject: `Προσφορά ${data.number} από ${data.company}`, body: `Προσφορά ${data.number} από ${data.company}: ${amount}${date ? `, ισχύει έως ${date}` : ""}. Δείτε την και αποδεχτείτε την εδώ:` }
      : { subject: `Τιμολόγιο ${data.number} από ${data.company}`, body: data.paid ? `Τιμολόγιο ${data.number} από ${data.company}, εξοφλημένο. Δείτε το και κατεβάστε το εδώ:`
        : `Τιμολόγιο ${data.number} από ${data.company}: ${amount}${date ? `, λήξη ${date}` : ""}. Δείτε το και κατεβάστε το εδώ:` };
    return data.kind === "quote"
      ? { subject: `Quote ${data.number} from ${data.company}`, body: `Quote ${data.number} from ${data.company}: ${amount}${date ? `, valid until ${date}` : ""}. View it, and accept it, here:` }
      : { subject: `Invoice ${data.number} from ${data.company}`, body: data.paid ? `Invoice ${data.number} from ${data.company}, paid in full. View it and download it here:`
        : `Invoice ${data.number} from ${data.company}: ${amount}${date ? `, due ${date}` : ""}. View it and download it here:` };
  });
  // In both languages, one line each before the link, not a separator.
  return { subject: block.subject, message: language === "en+el" ? block.body.replace("\n\n— English —\n\n", "\n") : block.body };
}
