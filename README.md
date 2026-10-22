# Ledgerline

Double-entry books, invoicing, AI document capture, a CRM and a practice
dashboard for Cyprus accountants and the companies they keep books for. It
runs on this laptop only: Next.js 16 with an embedded Postgres (PGlite) in
`.data/ledgerline`, and no sign-in (one fixed demo user). Every company,
person and figure in it is fictional.

## Start it

```bash
npm install                 # once
cp .env.example .env.local  # once, then put your key in it: ANTHROPIC_API_KEY=sk-ant-…
npm run demo:reset          # fresh demo data, build if needed, open http://localhost:3000
npm run demo                # the same, keeping whatever you did last time
npm run demo -- --build     # rebuild after changing code
```

No key yet? `LEDGERLINE_AI_FIXTURES=1 npm run demo` runs **rehearsal mode**:
the four files in `demo-files/` use readings recorded earlier, and Capture says
"Rehearsal mode" in a yellow band. Explain the figures and Ask the books need
the real key. Don't run rehearsal mode in the meeting.

**Before the meeting:** the key is in `.env.local` and was tested live on
22 Oct: the four demo files read in parallel in about 20 seconds, Explain the
figures takes about 20 seconds and Ask the books about 10. Run
`npm run demo:reset` so the meeting starts clean.

## The demo, step by step (about 30 minutes)

The practice is **Saltlake Accounting**, a fictional Larnaca firm with six
client companies, books from July 2025 to today, and October's bank lines left
to reconcile.

### 1. Practice dashboard (`/`), 2 minutes
- "This is the practice, not one company." Six clients on one screen.
- Point at **Aegean Blue Marine**: its Jul–Sep VAT return is due 10 Nov, 19
  days away, not filed, about €9,800 to pay. Cyprus quarters are staggered, so
  each client has its own due date; two clients aren't VAT registered (the
  dental clinic makes exempt supplies, the holding company only holds).
- 81 bank lines to reconcile, 3 documents waiting to review, overdue
  receivables per client, where each client's books are locked, last activity.
- Every figure is a link into that client's books.

### 1b. A company's Home, 1 minute
- Open **Larnaka Roast Coffee**. One company at a time: the switcher at the
  top of the menu changes it and keeps the section you are in.
- The Home is for the person who runs the company: six large buttons (Raise an
  invoice, Record a bill, Upload a receipt, Money in, Money out, Write a
  quote), three figures (in the bank, customers owe you, you owe suppliers),
  one list of what needs attention, and the to-dos. The accountant's pages are
  under Reports and **More**.

### 1c. Everyday work, 6 minutes
- **Raise an invoice**: choose a customer (or **+ New customer…** and type a
  name). The number follows on (`LRC-2026-0129`), the due date comes from the
  company's terms (14 days here), and VAT follows the customer: standard for a
  Cyprus customer, reverse charge for an EU business, exempt if the company
  isn't registered.
- **Lines with products**: type "House espresso blend" in the description and
  the product fills in its price, VAT rate (5%) and income account. Set the
  quantity (20 kg), add a second product (Coffee service, 9%) and a third
  with **Give a discount** (10%). The totals show VAT at each rate. The
  arithmetic is exact: the database works every line out again when it saves.
- **Save and issue**: "Issued and in the books". **View PDF** is what the
  customer receives: quantities and units, unit prices, the discount, VAT by
  rate, the company's registration, how to pay. **How it posted** shows the
  double entry.
- **Send**: the covering email is written for you (the amount, the due date,
  the bank details and reference); **Open in email** opens it in your email
  app, ready to attach the PDF, and the invoice is marked as sent. Invoices
  not yet sent are listed under **Not sent** and on the Home.
- **Record payment**, or tick **Paid already** on a new invoice for a card or
  cash sale: issued and paid in one step. **Copy** starts a new invoice from
  an old one.
- **Credit note** on an invoice: it starts with the invoice's lines; lower
  what is taken back, pick a reason, **Save and issue**. It comes off what the
  customer owes and off the VAT due on the return. Credit left over (see
  Pixelforge's `PF-CN-2026-0001`) is used against another invoice or refunded
  from the bank, and the refund can be matched on the statement.
- **Quotes** → `LRC-Q-002` → **Accepted: raise the invoice**: the invoice is
  issued with the quote's lines, numbered and dated today.
- **Repeating invoices**: the Home says "1 repeating invoice due" (the
  espresso machine lease). **Raise 1 due invoice**: it is raised on its date
  with the next number, and the schedule moves to next month. **Repeat** on
  any invoice starts one: monthly, quarterly, six-monthly or yearly, issued at
  once or saved as drafts to check. Nothing runs in the background: what has
  come due waits for one press.
- **Payment terms per customer**: Coral Sands pays in 30 days, Finikoudes in
  the company's 14; the due date follows whichever customer is chosen.
- **Customers** → Coral Sands Hotel: what they owe, their invoices, quotes and
  credit notes, and the CRM in one record. **Statement** is a PDF of their
  account with ageing. **Send a reminder** writes out the overdue invoices,
  the total and the bank details; **Open in email** opens it in your email
  app, and the reminder is logged on their timeline.
- **More → E-invoice (XML)** on an issued invoice or credit note: a UBL file
  in the Peppol BIS Billing 3.0 structure, the format the EU's ViDA rules
  build on for intra-EU business sales from July 2030. Checked on 22 Oct
  against the OASIS UBL 2.1 schema and the CEN EN 16931 rules (v1.3.17): no
  failures. (The Peppol network's own extra rules were not run.)
- **Their reference** on an invoice takes the customer's PO number; it is
  printed on the PDF and carried into the e-invoice.
- **More → Company settings → How your documents look**: the logo, colour and
  terms on every invoice, quote, credit note and statement. Larnaka Roast's
  are set (a fictional logo); the other companies print their names.
- **Products**: the company's price list. Also from the Home: **Record a
  bill**, **Money in/out**, **Upload a receipt** (it stays in this company
  unless its VAT number says otherwise). Numbering and terms are in **More →
  Company settings**.

### 1d. Buying and paying, 3 minutes
- **Bills**: tick the overdue bills (Highland Green, Troodos Dairy, Ermou
  Street) and **Pay them**: choose the account and the day, and each bill is
  paid in full in the books. The payment run then offers **Download the SEPA
  file**: one ISO 20022 file (pain.001.001.03) to upload to the company's
  online banking, which sends all the transfers on that day. Suppliers without
  an IBAN are listed to pay another way. Checked on 22 Oct against the ISO
  schema. When the payments show on the statement, they match in one press.
- **A supplier's credit note**: the October Highland Green bill already has
  one (two damaged sacks), taken off what is still to pay. On any bill, **More
  → Supplier credit note** starts one from the bill's lines; it lowers the
  cost and the VAT reclaimed (box 4), and credit left over is used against
  their next bill or recorded as refunded into the bank.
- **Suppliers** carry an IBAN and BIC, checked as banks check them.

### 1e. Bringing a client's lists in, 1 minute
- **Customers → Import** (also Suppliers and Products): choose a spreadsheet
  saved as CSV, or paste it. The columns are recognised from their headings,
  in English or Greek, and can be changed; every row is checked and shown
  before anything is saved, and anyone already there is left alone. There is a
  template to download. **Export** gives each list back as a spreadsheet, and
  **Invoices → Export all** every invoice with what was paid and credited.

### 1f. The CRM in every company, 2 minutes
- **Enquiries**: the pipeline board, New → Proposal sent → Won. Open one in
  Proposal sent: next action, timeline (log a call), stage. **Won: make a
  customer** adds them to Customers, with their first matter, so they can be
  invoiced straight away.
- **Matters** and **Tasks**: the work in hand and everything to do, each with
  an owner and a date.
- **Website form** (Enquiries → Website form): **Open the form** shows the
  company's own form, in its logo and colour. Send one as a prospect, then go
  back to the board: it is in New, marked "From your website", owned by
  whoever had the fewest open enquiries, with a call-back task due the next
  working day. The same page has the snippet for the company's own site and
  the API call (`POST /api/v1/enquiries`); **Make a new key** retires the old
  one at once. Enquiries nobody has answered for a day rise to the top of the
  board in red, and show on the company's Home.

### 1g. Deadlines (`/deadlines`), 2 minutes
- Every client's VAT returns, VIES statements, provisional tax and company
  tax returns, worked out from each company's VAT quarters and tax year,
  with who looks after it. Nobody typed a deadline in.
- **Overdue**: Kalamies Dental's first provisional tax instalment slipped.
  It is also on Kalamies' Home. **Mark done** closes it.
- A VAT return closes itself when it is filed: file one from **Open the
  return** and it shows as Done. A VAT return still to file says how ready it
  is: bank lines in the quarter to match, documents to check.
- Inside a company, **Deadlines** (under Reports) shows only its own. Who
  looks after a company is set in its Company settings.

### 1h. Time and fees (`/time`, `/fees`), 3 minutes
- **Start timer** in the top bar, on any page: it picks the company you are
  in. It keeps running as you move around, and stops in one press.
- **Time**: each person's week against their hours (Sofia is 2 hours over),
  the lighter part of each bar being time on clients. Add time worked
  without the timer; mark it **Extra** to bill it on top of the fee.
- **Fees**: each client's monthly fee against the hours its books took, as
  euros per hour, with the €40 floor as a dashed line. Kalamies Dental earns
  €32 an hour: reprice it. **Raise October's fees** invoices every client in
  one press from the firm's own books (Saltlake Accounting Ltd, under
  "Your firm's own books" in the company switcher), extra work included at
  each client's rate. Press again and nobody is billed twice.

### 1i. VAT numbers (`/vat-numbers`), 2 minutes
- A sale to a business in another EU state is zero-rated only if the
  customer's VAT number is valid in **VIES**, the European Commission's
  register; the tax office asks for the proof. This page checks any EU number
  live: type `IE6388047V` and VIES answers "Google Ireland Limited" with its
  address. Shape and check digit are checked as you type, for all 27 states
  and Northern Ireland, so a mistyped digit is caught before VIES is asked.
- **The registers** strip is live: member states take theirs down for
  maintenance, and the page says which (Greece was down on 22 Oct).
- **Every EU customer and supplier** across all the clients, with the last
  check: Pixelforge's Nordlicht confirmed last week (Germany discloses no
  name), Brabant last confirmed in June so due again, Atelier Lumière never.
  **Check every number now** re-checks them all and keeps every answer.
- On **Nimbus Cloud Services** (Pixelforge's suppliers), **Check in VIES**:
  the number is registered to "Stratocumulus Hosting B.V.", and the page says
  so. The same check sits on each EU customer, and on every reverse-charge
  invoice; the VIES statement has a "Confirmed in VIES" column, and Pixelforge's
  Home lists the EU customers to confirm.
- Every check is kept, on the company's audit trail, with **Copy as
  evidence**. The client companies are invented, so their answers come from
  a demo register and say "Demo answer"; any real number goes to the real
  VIES. Saving a customer or supplier with a mistyped EU number is refused.

### 2. AI capture (`/capture`), 4 minutes
- Drag all four files from `demo-files/` in at once:
  - `01-greek-marine-fuel-invoice.pdf`: Greek, addressed to ΑΙΓΑΙΟ ΜΠΛΟΥ…
  - `02-two-invoices-in-one-pdf.pdf`: two invoices for **two different clients**
  - `03-photographed-print-shop-invoice.jpg`: a phone photo, in Greek
  - `04-eu-reverse-charge-invoice.pdf`: a Dutch supplier charging no VAT
- Watch each row read in parallel. Then: five invoices found from four files,
  each routed to its client **by the customer's VAT number**, Greek
  transliterated, supplier matched (or new), accounts suggested from that
  client's own chart.
- Open **Review** on the Nimbus invoice: the six checks (lines add up, VAT per
  rate, net + VAT = total, Cyprus rates, supplier VAT number, not a duplicate)
  are Ledgerline's own arithmetic, not the AI's word. The reverse charge is
  detected: VAT due and reclaimed, boxes 1, 4, 7 and 11B.
- Show the document beside the extraction. Change a client with **Move here**
  to show the draft re-making itself in another company's books.
- **Post all**: every bill posts to the right company's ledger. Open one from
  "Posted from capture" and scroll to **How it posted**: the double entry.

### 3. Bank reconciliation, 3 minutes
- Dashboard → Aegean Blue's bank lines (or Bank in its books).
- "The bank should show" agrees with "The bank says": the sum explains itself.
- 18 of 19 October lines have a **sure** match: the bank's text names the
  invoice or bill and the amount agrees, or it is a card payment coded the same way
  many times before. **Match all 18**: one press.
- The one left is a **part payment** (Blue Horizon paid half an invoice):
  press the arrow, Invoices, take the half; the invoice stays open for the rest.
- Bulk coding: tick several lines, pick an account and VAT rate, **Code all**.
- Import: **Import a statement** → `demo-files/05-aegean-blue-boc-statement-21-oct.csv`
  (a Bank of Cyprus-style CSV). Import it a second time: nothing doubles.

### 4. Reports, 3 minutes
- **VAT return** (Reports → VAT return): the Jul–Sep return is on screen,
  box by box, due 10 Nov. **Mark as filed and lock the period**: the lock date
  moves to 30 Sep and nothing in the quarter can change any more (the database
  refuses, whatever the route). Back on the dashboard the return shows as
  filed.
- **Pixelforge Studio** VAT return: services to EU clients in box 8B, the
  reverse charge on its Dutch cloud supplier in 1, 4, 7 and 11B. Its **VIES
  statement** (Reports) lists the same sales by customer VAT number, as the
  recapitulative statement asks for them, and says that it agrees with 8B.
- P&L (try "month by month"), balance sheet, trial balance, general ledger,
  cash flow: one ledger, so they always agree. Every figure drills down.
- **Reports → Business overview**: twelve months of charts, the books health
  checks, **Explain the figures** (Claude reads totals only, never a name) and
  **Ask the books**, e.g. "What did we spend on fuel this year, month by month?"
- **More → Journals**: the entries written by hand (opening balances,
  accruals, corrections). Open one to edit it, remove it, or **Reverse** it:
  every debit becomes a credit, dated the first of the next month. A journal
  inside a locked period can only be reversed.
- **Audit trail**: every posting, match, lock and filing on a SHA-256 hash
  chain, with who did it; "The chain is intact" is recomputed on every view.

### 5. White label (Practice settings), 1 minute
- Type the accountant's firm name and initials, pick their colour: the page
  takes the colour as it is picked. **Save the brand**: every screen is now
  their product, with "Powered by Ledgerline" in the corner.

### 6. Ledgerline compared (`/compare`), 2 minutes
- Open it from **Powered by Ledgerline** at the bottom of the menu.
- One page against Balabook, from its public site (checked 20 Oct 2026).
  "Not stated" means its pages don't say, not that it lacks it.

## If something goes wrong
- **Reset demo data** at http://localhost:3000/settings?demo=1 rebuilds
  everything in about two seconds (or `npm run demo:reset`). The button is
  hidden from the normal settings page so the product doesn't look like a demo.
- Capture says "AI is not set up": the key isn't in `.env.local`, or the
  server was started before it was added. Stop (Ctrl+C) and `npm run demo`.
- Port 3000 busy: `PORT=3001 npm run demo`.
- A file fails to read: the row says why; drop it again. Nothing posts until
  someone presses Post, so a failed read never touches the books.

## How it is built
- `src/lib/db/schema.sql`: the ledger (journal entries rebuilt by
  `ledger_replace`, `post_*` triggers for invoices, payments, bills, bill
  payments and bank transactions, lock-date checks, bank reconciliation) with
  `organisation_id` on every books table and composite foreign keys, so a
  document can never post to another company's accounts. Plus the practice,
  capture, filed VAT returns and the hash-chained audit log.
- `src/lib/db/seed.ts`: the six fictional companies, generated from a fixed
  seed. `scripts/make-demo-files.mjs` renders the invoices in `demo-files/`.
- Selling (`src/app/c/[org]/sales`, `quotes`, `credit-notes`, `customers`, `items`;
  `src/lib/data/sales.ts`, `src/lib/actions/sales.ts`): invoices, quotes and
  credit notes share one line model (quantity, unit price, discount, VAT),
  worked out by `ledger_document_lines` in the database and, identically, by
  `src/lib/domain/line-math.ts` on screen. `save_invoice`, `save_quote`,
  `save_credit_note` and `accept_quote` write them; a credit note posts the
  reverse of a sale, `credit_allocations` set credit against invoices, and a
  refund is a bank payment against receivables. The PDFs (invoice, quote,
  credit note, statement) are `src/lib/documents/pdf.tsx` (react-pdf, Roboto
  embedded).
- The database rebuilds the demo data whenever `schema.sql` changes
  (`src/lib/db/index.ts` keeps the schema's hash), so a pull never leaves an
  old database behind.
- Buying (`src/app/c/[org]/bills`, `supplier-credits`; `src/lib/data/purchases.ts`,
  `src/lib/actions/purchases.ts`): `save_supplier_credit` posts the reverse of a
  bill and sets it against the bill; a refund from a supplier is money received
  against payables. Bills paid together are a `bill_payment_runs` row; its SEPA
  file is `src/lib/documents/sepa.ts`, and IBANs are checked in `src/lib/domain/iban.ts`.
- Imports (`src/lib/domain/imports.ts`, `src/lib/actions/imports.ts`,
  `src/components/common/import-form.tsx`): one reading of a row, used by the
  preview in the browser and again on the server.
- The company Home (`src/app/c/[org]/page.tsx`, `src/lib/data/home.ts`) and the
  menu with the company switcher (`src/components/shell/app-shell.tsx`).
- The CRM (`src/app/c/[org]/crm`, `src/lib/data/crm.ts`, `src/lib/actions/crm.ts`):
  enquiries, matters and tasks, one CRM per company, wired to that
  company's customers and invoices.
- `src/proxy.ts` tags each request under `/c/{company}` with the company, so
  the data layer and server actions (`src/lib/data`, `src/lib/actions`) know
  whose books they are in.
- Capture: `src/lib/ai/capture.ts` (the request to Claude, `claude-opus-5-5`,
  structured output), `src/lib/capture.ts` (checks, routing, supplier matching,
  the draft bill), `src/app/capture`.
- VAT numbers: `src/lib/domain/eu-vat.ts` checks each EU state's shape and
  check digit with no network (cross-checked against python-stdnum on 88,000
  numbers); `src/lib/vies.ts` asks the VIES REST API, retrying a busy register
  and falling back to a check without a consultation number when VIES won't
  take the company's own VAT number. Every answer is a `vat_checks` row on the
  audit chain. `vies_demo_register` answers for the invented companies, and
  `LEDGERLINE_VIES_FIXTURES=1` (the tests) keeps everything off the network.
- Not in this demo: sign-in (the production plan is Supabase auth and row-level
  security), currencies other than EUR, live bank feeds.
