/**
 * Invoices raised from money received. A business whose sales are in its
 * bank but not in its books (one moving over from spreadsheets, or one that
 * is paid before it invoices) turns each payment in into an invoice to the
 * payer for that amount, dated the day it arrived, and matched to it at once.
 * Client-safe: the review page and the server use the same arithmetic and
 * the same reading of names.
 */

/**
 * A payment that included VAT, split into its net and its VAT. The VAT is
 * what is left of the payment once the net is taken, so the two always add up
 * to the payment to the cent; a rate of 0 leaves it all net.
 */
export function splitGross(gross: number, rate: number) {
  const cents = Math.round(gross * 100);
  const net = Math.round((cents * 100) / (100 + rate));
  return { net: net / 100, vat: (cents - net) / 100 };
}

// The words that say what kind of company it is, not which: "Acme Trading Ltd" and "ACME TRADING LIMITED" are one customer.
const LEGAL_WORDS = new Set(["ltd", "limited", "llc", "plc", "inc", "co", "company", "the", "λτδ", "λιμιτεδ", "εταιρεια", "εταιρια"]);
const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** A name as a key for finding the same customer however a bank spells it: lower case, unaccented, without "Ltd" and punctuation. */
export function nameKey(name: string) {
  return plain(name).replace(/&/g, " and ").split(/[^\p{L}\p{N}]+/u).filter(word => word && !LEGAL_WORDS.has(word)).join(" ");
}

// What banks write before the payer's name on money in: "SEPA CREDIT FROM", "FASTER PAYMENTS RECEIPT", Revolut's "Money
// added from", Airwallex's "Deposit from", "ΜΕΤΑΦΟΡΑ ΑΠΟ". Whole phrases, so a payer called Bank Street Cafe keeps its name.
const LEADING = new RegExp(`^(?:${[
  "(?:incoming |inward )?sepa (?:inst(?:ant)? )?(?:credit(?: transfer)?|ct|sct|transfer|payment)", "inst(?:ant)? (?:credit|payment|transfer)",
  // These take a payer only when "from" follows: "Payment from Harbour Cafe Ltd" (Revolut), but not "Payment Solutions Ltd".
  "(?:payment|credit|standing order|funds|money|lodgement|lodgment)(?= from\\b)", "ref(?=[\\s:])",
  "faster payments?(?: receipt| credit| in)?", "fps(?: credit| receipt)?", "bacs(?: credit)?", "chaps(?: credit)?", "bgc", "bank giro credit", "giro credit",
  "incoming (?:payment|transfer|funds)", "inward (?:payment|remittance|transfer)", "credit transfer", "(?:funds )?transfer(?: received| in)?", "tfr", "trf",
  "payment received", "remittance", "money added", "received money", "deposit", "received", "receipt",
  "μεταφορ[αά]", "[εέ]μβασμα", "εισερχ[οό]μενο(?: [εέ]μβασμα)?", "π[ιί]στωση", "κατ[αά]θεση",
].join("|")})(?:\\s+(?:from|by|απ[οό]))?(?=[\\s:/.-]|$)[\\s:/.-]*`, "iu");
// And after it: the payer's own reference, an invoice number, a date, an account number, the bank's own code.
const TRAILING = /(?:\s+with reference\b.*|\s+(?:ref(?:erence)?|inv(?:oice)?)\.?(?:\s*no\.?)?\s*[:#]?\s*\S*\d.*|\s+(?:part payment|payment|on account)|\s+\S*\d{3,}\S*|\s+\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\s+(?:bgc|fpi|fpo|ft|so|dd|bp|sct|ct|tfr|trf|cr))+$/iu;
// Words kept in capitals when a name in capitals is made readable, and words with no vowel that are words all the same.
const KEEP_CAPS = new Set(["PLC", "LLC", "LLP", "LP", "UK", "EU", "US", "USA", "BV", "NV", "SA", "AG", "AB", "SRL", "SPA", "CIC"]);
const WORDS_ALL_THE_SAME = new Set(["LTD", "MR", "MRS", "MS", "DR", "ST", "BROS"]);

/**
 * A name in capitals, as banks write them, made readable: "ACME TRADING LTD"
 * becomes "Acme Trading Ltd". Anything already in mixed case is left alone,
 * as is Greek (its capitals carry no accents to restore) and a word with no
 * vowel, which is letters: "JCC", "KPMG".
 */
export function tidyName(name: string) {
  if (/\p{Ll}/u.test(name) || !/\p{Lu}/u.test(name) || /\p{Script=Greek}/u.test(name)) return name;
  return name.split(/(\s+)/).map(word => KEEP_CAPS.has(word.replace(/\W/g, "")) || (!/[AEIOUY]/.test(word) && !WORDS_ALL_THE_SAME.has(word.replace(/\W/g, ""))) ? word : word.toLowerCase().replace(/(^|['’(&/-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())).join("");
}

/** Who a payment in came from: the payer the bank names, or else its description without the bank's words, references and codes. */
export function payerName(line: { counterparty: string | null; description: string; reference?: string | null }) {
  if (line.counterparty?.trim()) return tidyName(line.counterparty.trim().replace(/\s+/g, " ")).slice(0, 120);
  let name = line.description.trim().replace(/\s+/g, " ");
  for (let pass = 0; pass < 3; pass++) {
    const next = name.replace(LEADING, "");
    if (next === name || !next.trim()) break;
    name = next;
  }
  const reference = line.reference?.trim();
  if (reference && reference.length >= 3) name = name.split(reference).join(" ").replace(/\s+/g, " ").trim();
  const cut = name.replace(TRAILING, "").replace(/[\s,.;:/-]+$/, "").trim();
  return tidyName(/\p{L}{2}/u.test(cut) ? cut : name).slice(0, 120);
}

/**
 * What an invoice raised from a payment says it was for: the payer's own
 * reference when it gave one that isn't just an invoice number of theirs;
 * else what the bank's description says beyond the bank's words and the
 * payer's name; else nothing, for the accountant to say.
 */
export function paymentDescription(line: { reference: string | null; description: string; counterparty: string | null }) {
  const payer = nameKey(payerName(line)).split(" ");
  const reference = line.reference?.trim().replace(/\s+/g, " ") ?? "";
  const words = (text: string) => text.split(/\s+/).filter(word => nameKey(word) && !payer.includes(nameKey(word)));
  if (reference && saysSomething(words(reference).join(" ")) && !/^(inv(oice)?|ref)\b/iu.test(reference)) return reference.slice(0, 300);
  let said = line.description.trim().replace(/\s+/g, " ");
  for (let pass = 0; pass < 3; pass++) { const next = said.replace(LEADING, ""); if (next === said) break; said = next; }
  const rest = words(said.replace(TRAILING, "")).join(" ");
  return saysSomething(rest) ? rest.slice(0, 300) : "";
}

/** Words, not a code: a word of four letters or more standing on its own, and fewer digits than not ("March retainer", not "FT26302ABCD" or "BOC/26/778812/OUT"). */
function saysSomething(text: string) {
  const digits = (text.match(/\d/g) ?? []).length;
  return /(?:^|[^\p{L}\p{N}])\p{L}{4,}(?=$|[^\p{L}\p{N}])/u.test(text) && digits * 2 < text.replace(/\s/g, "").length;
}

/** Whether a name says it is a company ("Ltd", "PLC"): "John Smith" and "John Smith Ltd" share a key, but aren't the same customer. */
export function namedAsCompany(name: string) {
  return /(?:^|[^\p{L}])(ltd|limited|llc|llp|plc|inc|co|company|corp|gmbh|bv|sarl|sa|λτδ|λιμιτεδ)\.?(?=$|[^\p{L}])/iu.test(name);
}

/**
 * Whether money in may come from one of the company's own people: a
 * director, a secretary, a shareholder. Their whole name in the payer's, or
 * their initial and surname ("A GEORGIOU" for Andreas Georgiou).
 */
export function fromPerson(payer: string, person: string) {
  const theirs = nameKey(payer).split(" ").filter(Boolean), words = nameKey(person).split(" ").filter(Boolean);
  if (words.length < 2 || namedAsCompany(payer)) return false;
  if (words.every(word => theirs.includes(word))) return true;
  const [first, last] = [words[0], words[words.length - 1]];
  return theirs.includes(last) && theirs.some(word => word.length === 1 && word === first[0]);
}

// Money in that isn't a sale to anyone: what to call it, and the words that give it away. Read unaccented, in lower case.
const NOT_SALES: [string, RegExp][] = [
  ["Looks like interest", /\binterest\b|\btok(os|oi|ou)\b/],
  ["Looks like a refund or a reversal", /\b(refund|refunded|reversal|reversed|chargeback|returned|epistrofh)\b/],
  ["Looks like a loan", /\b(loan|loans|daneio|daneia)\b/],
  ["Looks like a dividend", /\b(dividend|dividends|merisma)\b/],
  ["Looks like tax, or social insurance", /\b(tax department|tax dept|hmrc|hm revenue|vat refund|tmhma forologias|koinwnik\w* asfaliseis|social insurance)\b/],
  ["Looks like salary or payroll", /\b(salary|salaries|payroll|wages|misthos|misthoi)\b/],
  ["Looks like a grant", /\b(government grant|grant (?:payment|award|scheme|from)|subsidy|epixorhghsh)\b/],
  ["Looks like card or online takings, paid out net of fees", /\b(jcc(?: payment systems)?|viva ?wallet|viva payments|stripe (?:payments|payout|technology|transfer|uk|europe|ltd|limited|inc)|sumup|paypal|worldpay|square (?:payout|payments|europe|inc)|adyen|takepayments|dojo (?:payments|payout|tech\w*)|zettle|shopify (?:payments|payout)|klarna|(?:card|merchant|pos|terminal) (?:settlement|takings|deposit|payout|credit)|payout|settlement \d)\b|^stripe\s*$/],
  ["Looks like a cash deposit", /\b(cash deposit|atm deposit|katathesh metrhtwn)\b/],
  ["Looks like a transfer between the company's own accounts", /\b(own account|from savings|savings account|to savings|internal transfer|between accounts|metaxy logariasmwn)\b/],
  ["Looks like money from a director or shareholder", /\b(directors? (?:funds|injection|contribution|account|current account)|director's (?:loan|funds|account)|from (?:the )?directors?|shareholders? (?:funds|contribution|injection)|share capital|capital injection|dieythynth\w*|metoxo\w*)\b/],
];
// Greek written in Latin letters, so the words above find it: the bank's capitals carry no accents.
const GREEKLISH: Record<string, string> = { α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "h", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "x", ψ: "ps", ω: "w" };

/**
 * Why a payment in is unlikely to be a sale to its payer, or null: interest,
 * a refund, a loan, a dividend, tax, payroll, a grant, card takings paid out
 * net of fees, cash, a transfer between the company's accounts, money from
 * its directors, or money from the company itself (or a payer that is only
 * an account number). Each is coded on the reconcile page instead.
 */
export function notASale(line: { description: string; reference: string | null; counterparty: string | null }, payer: string, company: string) {
  const text = plain(`${line.description} ${line.reference ?? ""} ${line.counterparty ?? ""}`).replace(/[α-ως]/g, letter => GREEKLISH[letter] ?? letter);
  for (const [reason, pattern] of NOT_SALES) if (pattern.test(text)) return reason;
  const key = nameKey(payer), own = nameKey(company);
  if (!/\p{L}{3}/u.test(payer)) return "Looks like a transfer from an account, not a customer";
  if (own && (key === own || key.startsWith(`${own} `))) return "From the company itself";
  return null;
}

/**
 * Whether an invoice was raised from a payment: it says so, in the note it is
 * raised with ("Recorded on … from the payment received on …"), which nobody
 * can change on a paid invoice. Not by its number, which a person can type,
 * and whose prefix can change.
 */
export function raisedFromPayment(notes: string | null | undefined) {
  return /^Recorded on .+ from the payment received on .+\.$/.test(notes ?? "");
}
