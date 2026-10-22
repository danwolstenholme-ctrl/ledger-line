// Renders the fictional supplier invoices used in the demo, with Chrome via Playwright:
//   demo-files/        what to drag into Capture during the meeting
//   demo-files/fixtures/<sha256>.json   recorded readings, used only in rehearsal mode (LEDGERLINE_AI_FIXTURES=1)
//   src/lib/db/seed-files/              documents already waiting for review when the demo opens
// Every company, person and number here is invented.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "demo-files"), fixtures = path.join(out, "fixtures"), seed = path.join(root, "src/lib/db/seed-files");
for (const dir of [out, fixtures, seed]) fs.mkdirSync(dir, { recursive: true });

const eur = value => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = value => Math.round(value * 100) / 100;

function invoiceHtml(inv) {
  const greek = inv.lang === "el";
  const t = greek
    ? { title: "ΤΙΜΟΛΟΓΙΟ", no: "Αρ. Τιμολογίου", date: "Ημερομηνία", due: "Λήξη", to: "Προς", desc: "Περιγραφή", qty: "Ποσότητα", price: "Τιμή", net: "Καθαρό", vat: "ΦΠΑ", total: "Σύνολο", sub: "Καθαρό σύνολο", vatTotal: "ΦΠΑ", grand: "Πληρωτέο ποσό", vatNo: "Αρ. ΦΠΑ", pay: "Πληρωμή με τραπεζικό έμβασμα" }
    : { title: inv.title ?? "TAX INVOICE", no: "Invoice no.", date: "Date", due: "Due", to: "Bill to", desc: "Description", qty: "Qty", price: "Unit price", net: "Net", vat: "VAT", total: "Total", sub: "Net total", vatTotal: "VAT", grand: "Amount due", vatNo: "VAT No.", pay: "Payment by bank transfer" };
  const net = r2(inv.lines.reduce((s, l) => s + l.net, 0)), vat = r2(inv.lines.reduce((s, l) => s + l.vat, 0));
  return `<section class="page">
  <header><div class="logo" style="background:${inv.color}">${inv.mark}</div><div><h1>${inv.supplier}</h1><p>${inv.supplierAddress}<br>${t.vatNo}: ${inv.supplierVat}${inv.supplierTic ? ` · TIC ${inv.supplierTic}` : ""}<br>${inv.supplierContact}</p></div>
  <div class="doc"><h2>${t.title}</h2><table class="meta"><tr><td>${t.no}</td><td><b>${inv.number}</b></td></tr><tr><td>${t.date}</td><td>${inv.dateText}</td></tr>${inv.dueText ? `<tr><td>${t.due}</td><td>${inv.dueText}</td></tr>` : ""}</table></div></header>
  <div class="to"><span>${t.to}</span><b>${inv.billTo}</b><br>${inv.billToAddress}<br>${t.vatNo}: ${inv.billToVat}</div>
  <table class="lines"><thead><tr><th>${t.desc}</th><th>${t.qty}</th><th>${t.price}</th><th>${t.net} €</th><th>${t.vat} %</th><th>${t.vat} €</th></tr></thead><tbody>
  ${inv.lines.map(l => `<tr><td>${l.text}</td><td>${l.qty}</td><td>${eur(l.price)}</td><td>${eur(l.net)}</td><td>${l.rate}%</td><td>${eur(l.vat)}</td></tr>`).join("")}
  </tbody></table>
  <table class="totals"><tr><td>${t.sub}</td><td>€ ${eur(net)}</td></tr><tr><td>${t.vatTotal}${inv.reverse ? "" : ` ${[...new Set(inv.lines.map(l => l.rate))].join("/")}%`}</td><td>€ ${eur(vat)}</td></tr><tr class="grand"><td>${t.grand}</td><td>€ ${eur(r2(net + vat))}</td></tr></table>
  ${inv.reverse ? `<p class="note">VAT reverse charged: the customer accounts for VAT (Article 196, Council Directive 2006/112/EC).</p>` : ""}
  <footer>${t.pay}: ${inv.iban} · ${inv.footer ?? ""}</footer></section>`;
}

const CSS = `@page { size: A4; margin: 0 } body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; color: #1d2329; }
.page { width: 210mm; height: 297mm; box-sizing: border-box; padding: 18mm 16mm; page-break-after: always; position: relative; background: white; }
header { display: grid; grid-template-columns: 18mm 1fr auto; gap: 6mm; align-items: start; border-bottom: 2px solid #1d2329; padding-bottom: 6mm; }
.logo { width: 18mm; height: 18mm; border-radius: 3mm; color: white; font-weight: 700; font-size: 20px; display: grid; place-items: center; }
h1 { font-size: 17px; margin: 0 0 2mm; } header p { margin: 0; font-size: 11px; line-height: 1.5; color: #4b5560; }
.doc h2 { margin: 0 0 2mm; font-size: 20px; letter-spacing: .06em; text-align: right; } .meta td { font-size: 11px; padding: 1px 0 1px 6mm; text-align: right; }
.to { margin: 8mm 0; font-size: 12px; line-height: 1.5; } .to span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b7580; }
.lines { width: 100%; border-collapse: collapse; font-size: 11.5px; } .lines th { text-align: right; border-bottom: 1px solid #1d2329; padding: 2mm 1.5mm; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.lines th:first-child, .lines td:first-child { text-align: left; } .lines td { text-align: right; padding: 2.2mm 1.5mm; border-bottom: 1px solid #dfe3e7; }
.totals { margin: 6mm 0 0 auto; font-size: 12px; } .totals td { padding: 1.4mm 0 1.4mm 12mm; text-align: right; } .grand td { font-weight: 700; font-size: 14px; border-top: 2px solid #1d2329; }
.note { font-size: 11px; margin-top: 8mm; padding: 3mm; background: #f3f5f7; } footer { position: absolute; bottom: 14mm; left: 16mm; right: 16mm; font-size: 10px; color: #6b7580; border-top: 1px solid #dfe3e7; padding-top: 3mm; }`;

const line = (text, qty, price, rate, reverse = false) => { const net = r2(qty * price); return { text, qty: String(qty).replace(".", ","), price, net, rate: reverse ? 0 : rate, vat: reverse ? 0 : r2(net * rate / 100) }; };

const AEGEAN = { billTo: "ΑΙΓΑΙΟ ΜΠΛΟΥ ΘΑΛΑΣΣΙΕΣ ΥΠΗΡΕΣΙΕΣ ΛΤΔ", billToAddress: "Λεωφ. Φραγκλίνου Ρούσβελτ 14, 3011 Λεμεσός", billToVat: "CY10412907G" };
const TROODOS = { billTo: "Troodos Gold Olive Oil Ltd", billToAddress: "3 Makariou III Street, 2800 Kakopetria, Cyprus", billToVat: "CY10388104O" };
const ROAST = { billTo: "Larnaka Roast Coffee Co Ltd", billToAddress: "41 Ermou Street, 6021 Larnaca, Cyprus", billToVat: "CY10395540R" };
const PIXEL = { billTo: "PIXELFORGE STUDIO LTD", billToAddress: "8 Diagorou Street, 1097 Nicosia, Cyprus", billToVat: "CY10420118V" };
const DENTAL = { billTo: "Kalamies Dental Clinic Ltd", billToAddress: "22 Grigori Afxentiou Avenue, 6023 Larnaca", billToVat: "Not VAT registered · TIC 12401266Q" };

const docs = [
  { file: "01-greek-marine-fuel-invoice.pdf", dir: out, invoices: [{ ...AEGEAN, lang: "el", color: "#0b5394", mark: "IMF", supplier: "ΑΙΛΑΝΤ ΜΑΡΙΝ ΦΙΟΥΛΣ ΛΤΔ", supplierAddress: "Λιμάνι Λεμεσού, Κρηπίδωμα 7, 3042 Λεμεσός", supplierVat: "CY10355021F", supplierTic: "12355021W", supplierContact: "Τηλ. 25 000 410 · orders@islandmarinefuels.example",
    number: "IMF/2026/1318", date: "2026-10-16", dateText: "16/10/2026", due: "2026-11-15", dueText: "15/11/2026", iban: "CY62 0020 0195 0000 3570 0011 2233",
    lines: [line("Ναυτιλιακό πετρέλαιο (Marine gasoil) — λίτρα", 1200, 1.18, 19), line("Λιπαντικό κινητήρα 15W40 — δοχεία 20L", 4, 49, 19)] }],
    lineAccounts: ["315", "315"], descEn: ["Marine gasoil, litres", "Engine lubricant 15W40, 20L drums"] },
  { file: "02-two-invoices-in-one-pdf.pdf", dir: out, invoices: [
    { ...TROODOS, lang: "en", color: "#1b7f5a", mark: "MGB", supplier: "Mediterranean Glass Bottles Ltd", supplierAddress: "Industrial Area, 14 Ifestou Street, 2540 Dali, Cyprus", supplierVat: "CY10233611W", supplierContact: "sales@medglass.example · +357 22 000 552",
      number: "MGB2610-014", date: "2026-10-12", dateText: "12 October 2026", due: "2026-11-11", dueText: "11 November 2026", iban: "CY44 0050 0145 0001 4501 7777 0001",
      lines: [line("Dark glass bottles 750ml, Marasca", 2400, 0.42, 19), line("Natural cork stoppers", 2400, 0.06, 19), line("Shrink capsules, gold", 2400, 0.03, 19)] },
    { ...ROAST, lang: "en", color: "#8a3b12", mark: "KM", supplier: "Kafe Machines Cyprus Ltd", supplierAddress: "52 Artemidos Avenue, 6031 Larnaca, Cyprus", supplierVat: "CY10598877L", supplierContact: "service@kafemachines.example",
      number: "KMC-4471", date: "2026-10-14", dateText: "14/10/2026", due: "2026-10-28", dueText: "28/10/2026", iban: "CY18 0180 0001 0000 0020 4471 0001",
      lines: [line("Espresso machine service visit, 2-group", 1, 85, 19), line("Group head gaskets", 2, 18.5, 19), line("Shower screens", 2, 12, 19)] }],
    lineAccounts: [["315", "315", "315"], ["473", "473", "473"]] },
  { file: "03-photographed-print-shop-invoice.jpg", dir: out, photo: true, invoices: [{ ...PIXEL, lang: "el", color: "#6d28d9", mark: "ΤΛ", supplier: "ΤΥΠΟΓΡΑΦΕΙΟ ΛΕΥΚΩΣΙΑΣ ΛΤΔ", supplierAddress: "Οδός Ονασαγόρου 31, 1011 Λευκωσία", supplierVat: "CY10477120Τ".replace("Τ", "T"), supplierContact: "Τηλ. 22 000 318",
    number: "2026/0937", date: "2026-10-19", dateText: "19/10/2026", iban: "CY71 0020 0128 0000 0012 3318 0937",
    lines: [line("Επαγγελματικές κάρτες, 500 τεμ.", 2, 45, 19), line("Φυλλάδια Α5, 1000 τεμ.", 1, 240, 19)] }],
    lineAccounts: ["400", "400"], descEn: ["Business cards, 500 pcs", "A5 brochures, 1000 pcs"] },
  { file: "04-eu-reverse-charge-invoice.pdf", dir: out, invoices: [{ ...PIXEL, billTo: "Pixelforge Studio Ltd", lang: "en", color: "#2563eb", mark: "N", title: "INVOICE", supplier: "Nimbus Cloud Services BV", supplierAddress: "Keizersgracht 210, 1016 DZ Amsterdam, Netherlands", supplierVat: "NL822334458B01", supplierContact: "billing@nimbuscloud.example",
    number: "NCS-202610-7711", date: "2026-10-01", dateText: "1 Oct 2026", due: "2026-10-01", dueText: "Paid by card on file", iban: "NL91 ABNA 0417 1643 00", reverse: true,
    lines: [line("Compute instances, September usage", 1, 842.4, 19, true), line("Managed database, standard tier", 1, 196, 19, true), line("Object storage and egress", 1, 48, 19, true)] }],
    lineAccounts: ["485", "485", "485"] },
  // Already waiting for review when the demo opens.
  { file: "marathasa-pressing-october.pdf", dir: seed, seedOrg: "troodos-gold", invoices: [{ ...TROODOS, billTo: "ΤΡΟΟΔΟΣ ΓΚΟΛΝΤ ΕΛΑΙΟΛΑΔΟ ΛΤΔ", billToAddress: "Μακαρίου Γ΄ 3, 2800 Κακοπετριά", lang: "el", color: "#556b2f", mark: "ΕΜ", supplier: "ΕΛΑΙΟΤΡΙΒΕΙΟ ΜΑΡΑΘΑΣΑΣ ΛΤΔ", supplierAddress: "Κεντρική Οδός 12, 2865 Καλοπαναγιώτης", supplierVat: "CY10120339W", supplierContact: "Τηλ. 22 000 952",
    number: "ΤΔΑ 26118", date: "2026-10-17", dateText: "17/10/2026", due: "2026-11-16", dueText: "16/11/2026", iban: "CY30 0050 0145 0001 4501 2020 1180",
    lines: [line("Έκθλιψη ελιών — κιλά", 3200, 0.31, 5), line("Αποθήκευση λαδιού σε δεξαμενή", 1, 140, 5)] }],
    lineAccounts: ["310", "310"], descEn: ["Olive pressing, kilos", "Oil storage in tank"] },
  { file: "dentalpro-supplies-4471.pdf", dir: seed, seedOrg: "kalamies-dental", invoices: [{ ...DENTAL, lang: "en", color: "#0e7490", mark: "DP", supplier: "DentalPro Supplies Ltd", supplierAddress: "9 Spyrou Kyprianou Avenue, 6051 Larnaca", supplierVat: "CY10190244Z", supplierContact: "orders@dentalpro.example",
    number: "DP2610-021", date: "2026-10-15", dateText: "15 Oct 2026", due: "2026-11-14", dueText: "14 Nov 2026", iban: "CY12 0020 0195 0000 3570 4471 0021",
    lines: [line("Composite resin kits A2", 6, 64, 19), line("Nitrile gloves, box of 100", 20, 7.9, 19), line("Impression material, fast set", 4, 38.5, 19)] }],
    lineAccounts: ["310", "310", "310"] },
  { file: "harbour-pilotage-october.pdf", dir: seed, seedOrg: "aegean-blue-marine", invoices: [{ ...AEGEAN, billTo: "Aegean Blue Marine Services Ltd", billToAddress: "14 Franklin Roosevelt Avenue, 3011 Limassol", lang: "en", color: "#1e3a5f", mark: "HP", supplier: "Harbour Pilotage Services Ltd", supplierAddress: "Limassol Port, Gate 3, 3042 Limassol", supplierVat: "CY10233190L", supplierContact: "accounts@harbourpilotage.example",
    number: "HP2610-024", date: "2026-10-18", dateText: "18 October 2026", due: "2026-11-17", dueText: "17 November 2026", iban: "CY81 0020 0128 0000 0012 9090 2410",
    lines: [line("Pilotage, MV Horizon Star inbound", 1, 1240, 19), line("Mooring and line handling", 1, 385, 19)] }],
    lineAccounts: ["310", "310"] },
];

function fixtureFor(doc) {
  return { invoices: doc.invoices.map((inv, index) => {
    const accounts = Array.isArray(doc.lineAccounts[0]) ? doc.lineAccounts[index] : doc.lineAccounts;
    const net = r2(inv.lines.reduce((s, l) => s + l.net, 0)), vat = r2(inv.lines.reduce((s, l) => s + l.vat, 0));
    const latin = { "ΑΙΛΑΝΤ ΜΑΡΙΝ ΦΙΟΥΛΣ ΛΤΔ": "Island Marine Fuels Ltd", "ΤΥΠΟΓΡΑΦΕΙΟ ΛΕΥΚΩΣΙΑΣ ΛΤΔ": "Lefkosia Print Shop Ltd", "ΕΛΑΙΟΤΡΙΒΕΙΟ ΜΑΡΑΘΑΣΑΣ ΛΤΔ": "Marathasa Olive Pressing Ltd" }[inv.supplier] ?? inv.supplier;
    return {
      pages: doc.invoices.length > 1 ? String(index + 1) : "1", document_type: "invoice", language: inv.lang,
      supplier: { name: inv.supplier, name_latin: latin, vat_number: inv.supplierVat, country: inv.supplierVat.slice(0, 2), address: inv.supplierAddress, iban: inv.iban.replace(/\s/g, "") },
      bill_to: { name: inv.billTo, vat_number: inv.billToVat.startsWith("CY") ? inv.billToVat : null }, client_ref: null,
      invoice_number: inv.number, issue_date: inv.date, due_date: inv.due ?? null, currency: "EUR",
      lines: inv.lines.map((l, i) => ({ description: l.text, description_en: doc.descEn?.[i] ?? l.text, net: l.net, vat_rate: l.rate, vat_amount: l.vat, account_code: accounts[i] })),
      totals: { net, vat, total: r2(net + vat) }, reverse_charge: Boolean(inv.reverse), handwritten_or_photo: Boolean(doc.photo), confidence: doc.photo ? "medium" : "high", warnings: [],
    };
  }) };
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1800 }, deviceScaleFactor: 1.5 });
const captures = [];
for (const doc of docs) {
  const target = path.join(doc.dir, doc.file);
  const body = doc.invoices.map(invoiceHtml).join("");
  if (doc.photo) {
    // A phone photo of the printed invoice on a desk: tilted, lit unevenly, a little soft.
    await page.setContent(`<html><head><style>${CSS}
      body { background: radial-gradient(circle at 30% 20%, #8a7458, #4a3b2a 70%); width: 1400px; height: 1800px; display: grid; place-items: center; overflow: hidden; }
      .paper { transform: perspective(1800px) rotateX(9deg) rotateZ(-4deg) scale(1.18); box-shadow: 0 40px 60px rgba(0,0,0,.45); filter: contrast(1.05) brightness(.97) blur(.35px); }
      .paper .page { height: auto; min-height: 297mm; background: linear-gradient(160deg, #fffdf7 0%, #f4efe3 55%, #e9e2d2 100%); }
      .glare { position: fixed; inset: 0; background: linear-gradient(115deg, rgba(255,255,255,.0) 35%, rgba(255,255,255,.18) 48%, rgba(255,255,255,0) 60%); }</style></head>
      <body><div class="paper">${body}</div><div class="glare"></div></body></html>`);
    await page.screenshot({ path: target, type: "jpeg", quality: 82 });
  } else {
    await page.setContent(`<html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`);
    await page.pdf({ path: target, format: "A4", printBackground: true });
  }
  const sha = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  const fixture = fixtureFor(doc);
  if (doc.dir === out) fs.writeFileSync(path.join(fixtures, `${sha}.json`), JSON.stringify(fixture, null, 2));
  else captures.push({ file: doc.file, media: "application/pdf", org: doc.seedOrg, extraction: fixture.invoices[0] });
  console.log("wrote", path.relative(root, target));
}
fs.writeFileSync(path.join(seed, "captures.json"), JSON.stringify(captures, null, 2));

// A statement to import during the demo: two new lines, coded the way such lines always are.
fs.writeFileSync(path.join(out, "05-aegean-blue-boc-statement-21-oct.csv"), [
  "Transaction Date,Description,Debit,Credit,Balance,Reference",
  "21/10/2026,CARD PURCHASE FUEL STATION GERMASOGEIA,74.20,,,",
  "21/10/2026,CARD PURCHASE HARBOUR CAFE LIMASSOL,38.50,,,",
].join("\r\n") + "\r\n");
console.log("wrote demo-files/05-aegean-blue-boc-statement-21-oct.csv");
await browser.close();
