# Ledgerline

Double-entry books, invoicing, AI document capture, a CRM and a practice
dashboard for Cyprus accountants and the companies they keep books for. It
runs on this laptop: Next.js 16 with an embedded Postgres (PGlite) in
`.data/ledgerline`, and no sign-in yet (one fixed demo user). The same code
runs on Supabase: see Going live on Supabase. Every company,
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

### 1a. Who sees what (`/sign-in`), 1 minute
- Top right, your name → **Sign in as someone else**: the demo's people.
  **Nikos Savva** owns Pixelforge: he lands on its books, with no practice
  pages and no other client; Pixelforge's AML file isn't his to see. The
  database decides this, not the screens (row-level security).
- Back as Maria: **Practice settings → People → Invite someone**. The link
  is shown once; open it in a private window to join as the new person.

### 1b. A company's Home, 1 minute
- Open **Larnaka Roast Coffee**. One company at a time: the switcher at the
  top of the menu changes it and keeps the section you are in.
- The Home is for the person who runs the company: six large buttons (Raise an
  invoice, Record a bill, Upload a receipt, Money in, Money out, Write a
  quote), three figures (in the bank, customers owe you, you owe suppliers),
  one list of what needs attention, and the to-dos. The menu runs the way the
  owner works: **CRM** (enquiries, customers, quotes, invoices, products,
  matters, tasks, calendar), then **Money** (bank, receipts, bills,
  suppliers), then **Reports & tax**; the accountant's pages are under
  **More**.

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

### 1f. The CRM, shaped to each business, 4 minutes
- Every company is set up from its **kind of business**, which the accountant
  picks when taking the client on: what it calls its customers and its work,
  the stages its enquiries and its work go through, the details it keeps, and
  which parts it uses. Switch company and watch the menu change:
  - **Aegean Blue Marine** (shipping): Clients, Enquiries, and **Jobs** that
    go Planned → In port → Final account → Closed, each with its vessel, port
    and ETA on the card.
  - **Kalamies Dental** (clinic): **Patients and insurers**, and **Treatment
    plans** (Proposed → Accepted → In treatment → Completed), with who pays.
  - **Larnaka Roast** (café and roastery): **Orders**, Received → Roasting →
    Ready → Delivered, collection or delivery on the card.
  - **Troodos Gold** (producer): **Leads** and **Orders**; **Pixelforge**
    (software studio): **Deals** and **Projects** with their fee basis;
    **Mesogeios Holdings**: only **Opportunities** and tasks, no quotes or
    jobs; **Thames Edge Joinery**: **Jobs** with the site address, opening in
    maps.
- **The board**: drag a card from stage to stage. Drop a deal on **Won** and it
  becomes a customer with its first job and first to-do (for a port agent,
  "Send the proforma disbursement account"); drop it on **Lost** and it asks
  why. Each column shows its value and how likely it is; the header, the
  pipeline's value and the likely part of it.
- Open any deal or customer: **Call**, **WhatsApp**, **Viber** or **Email** with
  the message started, and **Save contact** to the phone. Plain links: nothing
  to connect.
- **Customise** (under More): rename anything ("Jobs" to "Shipments"), add a
  stage, turn a part off, or add a detail of its own ("Pallets", on every
  card). Set by the company's owner or its accountant; its staff use it as
  set, and never see payroll.
- **Tasks**: everything to do, each with an owner and a date.
- **Website form** (Enquiries → Website form): **Open the form** shows the
  company's own form, in its logo and colour. Send one as a prospect, then go
  back to the board: it is in New, marked "From your website", owned by
  whoever had the fewest open enquiries, with a call-back task due the next
  working day. The same page has the snippet for the company's own site and
  the API call (`POST /api/v1/enquiries`); **Make a new key** retires the old
  one at once. Enquiries nobody has answered for a day rise to the top of the
  board in red, and show on the company's Home.

### 1g. Deadlines (`/deadlines`), 2 minutes
- Every client's VAT returns, VIES statements, provisional tax, company tax
  returns and the balance of tax; payroll returns each month and the
  employer's annual TD7; the financial statements and the annual return
  (HE32) for the Registrar. All worked out from each company's VAT quarters,
  tax and financial years, incorporation date and the services the practice
  provides, with who looks after it. Nobody typed a deadline in.
- An official extension moves a date and says so: Kalamies' 2025 employer's
  return shows **Extended from 31 May 2026 by the Tax Department**, with the
  announcement linked.
- **Overdue**: Kalamies Dental's first provisional tax instalment slipped.
  It is also on Kalamies' Home. **Mark done** closes it.
- A VAT return closes itself when it is filed: file one from **Open the
  return** and it shows as Done. A VAT return still to file says how ready it
  is: bank lines in the quarter to match, documents to check.
- Inside a company, **Deadlines** (under Reports & tax) shows only its own. Who
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

### 1i. Taking on a client (`/clients`), 4 minutes
- **Client files**: every client's due diligence as ICPAC's AML Directive
  asks for it: risk rating, next review, and screening against the EU
  sanctions list. Mesogeios' review is a week overdue (it is on Deadlines
  too); Kalamies' is due in three weeks.
- **Kypros Ferry Lines**, won from the firm's own website form, is half way
  through being taken on. **Send the engagement letter**: it is written from
  the file (services, fee, the app) and fingerprinted. Copy the client's link
  and open it in a private window, or on a phone: no login. Sign it, and
  upload Alexander Petrov's proof of address (any PDF). Back on the file both
  are ticked, and the signed PDF carries the signature record.
- **Screen everyone**: the company and both owners are checked against the
  real EU consolidated list (6,269 people and entities). Alexander Petrov
  shares his name with two listed persons, born in 1958 and 1979: write why
  he is not them and **Record the decision**.
- **Risk assessment**: Ledgerline scores each factor from the file, as in
  ICPAC's guidance. The 40% owner's nationality is on the EU high-risk list,
  and an advocate introduced them: 9 of 20, normal risk, customer due
  diligence, reviewed every two years. **Record the assessment**, then
  **Approve as compliance officer**. A PEP, or an owner living in a
  high-risk country, makes it high risk whatever the score, approved by a
  partner.
- **Take them on: open the books**: the company opens with the standard
  chart, its VAT quarters and year end, its deadlines, its fee on the Fees
  page, and a customer record in the firm's own books. Every step is on the
  firm's audit trail, the signature as the client's.

### 1j. VAT numbers (`/vat-numbers`), 2 minutes
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

### 1k. Year end and audit (a company's **Year end**, under Reports & tax), 3 minutes
- **Kalamies Dental**: 2025's turnover and total assets, and 2024's, are within
  the limits, so its accounts may be **reviewed** (ISRE 2400) instead of
  audited, and the company has chosen that. The page shows why, figure by
  figure. Its 2026 year began before 6 February 2026, so the old €200,000
  turnover limit still applies to it; the €300,000 limit starts with 2027.
- **Larnaka Roast**: 2024's turnover was over the limit, so 2025 must be
  audited. The steps run in the order the law sets, each with its due date.
  The annual general meeting is past its date (15 months after the last one)
  and shows in red. **Record dates**: a report dated before the board approved
  the accounts is refused (ISA 700).
- **Before it goes to the auditor**: the trial balance, the lock date, bank
  lines, VAT returns, the manual journals an auditor will ask about (ISA 240;
  opening balances, agreed to last year's accounts under ISA 510) and the audit
  trail.
- **Download the audit file**: one ZIP of CSVs (trial balance, P&L, balance
  sheet, general ledger, journal, manual journals, receivables and payables at
  the year end, bank, VAT returns, the audit trail), and a read-me with the
  checks and each file's SHA-256.
- **Troodos Gold** is audited by the practice itself: the page says what the
  IESBA Code (section 601) asks of a firm that audits books it keeps.
- **People** (under More): invite the auditor with the role **Auditor**. They
  read the books and take the audit file; the database refuses any change.

### 1l. Calendar (`/calendar`, and **Calendar** in each company), 2 minutes
- What is due, on its day: month, week or agenda. Across all clients it opens
  on the filing deadlines; **Everything** adds each client's tasks, invoices
  falling due (one line per client per day) and quotes running out. Pick a
  client to see that one alone; inside a company it is that company's.
- **Agenda**: what is overdue first (Kalamies' slipped provisional tax,
  Mesogeios' AML review), then each day.
- **Subscribe in your calendar**: a private link for Google, Outlook or Apple
  Calendar showing what the page shows, given once; making a new one stops the
  old. On the laptop, Apple Calendar can read it; Google and Outlook read from
  their own servers, so they need Ledgerline online.

### 1m. Two UK clients, 3 minutes
- Each company has its own country: its currency, chart of accounts, VAT
  rates, VAT return and deadlines follow it. Switch to **Thames Edge Joinery**
  (Reading): pounds, the UK chart, VAT at 20%, 5% or 0%.
- It is a joinery subcontractor: its sales to contractors are under the CIS
  domestic reverse charge (the invoice says "customer to pay the VAT to HMRC"),
  and it buys in labour the same way. **VAT returns**: HMRC's nine boxes, the
  construction reverse charge in boxes 1 and 4, and a repayment each quarter.
- **Record a bill** from Wren Site Labour: the reverse charge is a choice,
  because each kind fills different boxes (services from abroad, construction,
  imports under postponed VAT accounting).
- **Willow & Wren Design** (Bristol) is on the Flat Rate Scheme at 12%: its
  return is 12% of the turnover with its VAT, less VAT on the one computer over
  £2,000. **Mark as filed**: the rest of the VAT charged moves to account 265,
  Flat Rate Scheme surplus. Its **Company settings** hold the scheme.
- Their **Deadlines** are HMRC's and Companies House's; their **Year end**
  tests the small-company audit exemption. Submitting to HMRC through Making
  Tax Digital is the next step, built against HMRC's sandbox first.

### 1n. Payroll (a company's **Payroll**, under Money), 3 minutes
- **Aegean Blue Marine**: four employees, each with their salary, tax and
  social insurance numbers, and what the previous payroll paid them from
  January to September, brought forward so this year's tax is right from the
  first month in Ledgerline. **Nikos Charalambous** declared two children on
  TD59.
- **Run October 2026's payroll**: every payslip worked out as a draft. Social
  insurance 8.8% each way up to the month's maximum, GESY 2.65% and 2.9%, the
  employer's funds, and income tax: the year's tax at today's pay, less what
  has been withheld. **To pay by 30 Nov 2026** says what goes to Social
  Insurance Services, what to the Tax Department with the monthly TD7, and
  what to the employees.
- **Overtime, a bonus or commission this month**: add €250 for Andri Ioannou
  and the month is worked out again, tax included.
- **Approve and post October 2026**: one entry in the books on the pay date
  (wages and contributions against what is owed to each), and the month is
  fixed. Then **Payslips** (a PDF, a page each, with the year to date),
  **Salary payments file** (SEPA, marked as salaries, to upload to the bank)
  and **TD7 and Social Insurance figures** (a CSV, employee by employee).
- December pays the 13th salary on its own: insurable only up to what is left
  of the year's maximum. A UK company has no Payroll in its menu yet.

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

## Cyprus rules Ledgerline follows (checked 26 October 2026)

The dates and tests are in `src/lib/domain` (`deadlines.ts`, `vat.ts`,
`extensions.ts`, `audit.ts`), and `npm run check:rules` checks each one.

- **Company tax return (IR4)**: for tax years to 2025, 31 March two years on;
  from tax year 2026, 31 January two years on (13 months), with the balance of
  tax. For years to 2025 the balance is paid by 1 August of the following year.
  Provisional tax: 31 July and 31 December. Corporation tax is 15% from 2026.
- **VAT**: the return and payment by the 10th of the second month after the
  quarter; VIES by the 15th of the month after a month with EU services.
- **Payroll**: the monthly TD7, Social Insurance, GESY and tax withheld by the
  end of the following month; the employer's TD7 by 31 May of the next year.
- **What payroll works out** (`payroll-cy.ts`, checked 27 October 2026):
  social insurance 8.8% from the employee and 8.8% from the employer on
  earnings up to the month's maximum (€5,551 in 2025, €5,742 in 2026), and on
  the same earnings the Redundancy Fund (1.2%) and the Human Resource
  Development fund (0.5%); GESY 2.65% and 2.9% on all pay up to €180,000 a
  year; the Social Cohesion Fund, 2% on all pay. A 13th salary is declared on
  its own, insurable only up to what is left of the year's maximum. Income
  tax from 2026: nothing to €22,000, then 20%, 25% (from €32,000), 30% (from
  €42,000) and 35% (over €72,000); 2025's bands start at €19,500. Social
  insurance and GESY are deducted up to a fifth of the pay, and so is what the
  employee declares on TD59. The Central Holiday Fund is left out: most
  employers are exempt and run their own leave.
- **Official extensions** (`extensions.ts`, kept from the announcements): 2024
  company tax returns and the 2025 employer's return to 30 November 2026; the
  VAT return for the quarter to 30 November 2025 and December 2025's VIES to
  20 January 2026; the quarter to 30 June 2026 and July 2026's VIES to
  20 August 2026.
- **Registrar (Companies Law, Cap. 113)**: financial statements within 12
  months of the year end (s.142(2)); the annual return (HE32) made up to the
  day after 18 months from incorporation and each year on, filed within 28
  days (s.120); an AGM every year, at most 15 months apart (s.125).
- **Audit or review (s.152A)**: every company is audited, except that a private
  company within the limits in two consecutive years may choose a review under
  ISRE 2400. The limits are turnover (with rent, interest, dividends and
  royalties) up to €200,000 for years beginning before 6 February 2026 and
  €300,000 from then, and total assets up to €500,000. A review is not open to
  a group that consolidates, nor to a company regulated by the Central Bank,
  CySEC or the Superintendent of Insurance, or holding a qualifying stake in one.
- **Size (s.141A)**: micro, small and medium at €450k/€900k/10,
  €5m/€10m/50 and €25m/€50m/250 (total assets, turnover, employees), with at
  most one limit exceeded.
- **Framework**: IFRS as adopted by the EU. A small company may use the
  Financial Reporting Standard for small-sized entities (s.142(1)(α1)) once
  ICPAC issues it; it has not yet.
- **Records**: kept at least six years. The Companies Law counts from the end
  of the year they relate to, tax law from when that year's return is filed.

Sources: [Cap. 113, consolidated, on CyLaw](http://www.cylaw.org/nomoi/enop/non-ind/0_113/full.html);
[PwC Tax Summaries, Cyprus tax administration](https://taxsummaries.pwc.com/cyprus/corporate/tax-administration);
[EY, Cyprus enacts major tax reform legislation](https://globaltaxnews.ey.com/news/2026-0140-cyprus-enacts-major-tax-reform-legislation);
[ICPAC's financial reporting standards-setting committee](https://www.cbn.com.cy/article/129614/icpac-appoints-financial-reporting-standards-setting-committee);
[PwC Tax Summaries, Cyprus: personal income tax](https://taxsummaries.pwc.com/cyprus/individual/taxes-on-personal-income),
[deductions](https://taxsummaries.pwc.com/cyprus/individual/deductions) and
[other taxes](https://taxsummaries.pwc.com/cyprus/individual/other-taxes);
[KPMG Cyprus, maximum insurable earnings for 2026](https://kpmg.com/cy/en/insights/tax-alerts/amendment-to-the-maximum-amount-of-insurable-earnings-for-2026.html);
and, for each extension, the announcement linked in `src/lib/domain/extensions.ts`.

## UK rules Ledgerline follows (checked 27 October 2026)

In `src/lib/domain` (`regimes.ts`, `vat-uk.ts`, `deadlines.ts`, `audit.ts`,
`eu-vat.ts`) and `uk_vat_figures` in the schema; `npm run check:rules` checks
each one.

- **VAT**: 20%, 5% and 0%, exempt and outside the scope. The return and its
  payment 1 calendar month and 7 days after the period; under annual
  accounting, 2 months after the year, with nine payments on account of 10% or
  three of 25%.
- **The nine boxes**: reverse charges in boxes 1 and 4: services bought from
  abroad (and in box 6 and 7), construction services under the CIS domestic
  reverse charge, and imports under postponed VAT accounting (and in box 7).
  Credit notes come off boxes 1 and 4. Wages, PAYE and NIC, business rates and
  dividends are never on a return. Boxes 2, 8 and 9 (Northern Ireland's goods
  trade with the EU) are not handled yet.
- **Flat Rate Scheme**: the rate times VAT-inclusive turnover; only single
  capital purchases of £2,000 or more with VAT are reclaimed; box 6 includes
  VAT. It cannot be combined with the Cash Accounting Scheme, but has its own
  cash-based turnover; it can be combined with annual accounting.
- **Cash accounting**: VAT when customers pay and suppliers are paid, each
  payment split between net and VAT as its document was.
- **Companies House and HMRC**: annual accounts 9 months after the year end
  (the first, for a first period over a year, the later of 21 months from
  incorporation and 3 months after it); Corporation Tax 9 months and a day
  after; the Company Tax Return (CT600) 12 months after; the confirmation
  statement within 14 days of each anniversary. A deadline counted from a month
  end runs to a month end (Companies Act 2006, s.443).
- **Audit exemption**: a small company, within two of turnover £15m, total
  assets £7.5m and 50 employees, for years beginning on or after 6 April 2025
  (£10.2m and £5.1m before).
- **GB VAT numbers**: 9 digits whose check digits pass HMRC's mod 97 test (or
  the same with 55 added, for numbers issued since 2009). VIES does not hold
  them; HMRC's own check comes with Making Tax Digital.
- **An individual's tax year**: 6 April to 5 April.

Sources (GOV.UK): [How to fill in your VAT Return (VAT Notice 700/12)](https://www.gov.uk/guidance/how-to-fill-in-and-submit-your-vat-return-vat-notice-70012);
[import VAT on the return](https://www.gov.uk/guidance/complete-your-vat-return-to-account-for-import-vat);
[Flat Rate Scheme](https://www.gov.uk/vat-flat-rate-scheme) and [VAT Notice 733](https://www.gov.uk/government/publications/vat-notice-733-flat-rate-scheme-for-small-businesses/vat-notice-733-flat-rate-scheme-for-small-businesses);
[Cash Accounting Scheme](https://www.gov.uk/vat-cash-accounting-scheme);
[annual accounting deadlines](https://www.gov.uk/vat-annual-accounting-scheme/return-and-payment-deadlines);
[Company Tax Returns](https://www.gov.uk/company-tax-returns); [annual accounts](https://www.gov.uk/prepare-file-annual-accounts-for-limited-company);
[confirmation statement](https://www.gov.uk/guidance/confirmation-statement-guidance);
[audit exemptions](https://www.gov.uk/audit-exemptions-for-private-limited-companies).

## Going live on Supabase

Live, Ledgerline runs on Supabase's Postgres in the EU (Frankfurt), with the
same schema and the same access rules as the laptop demo. The laptop demo
enforces those rules too: what it shows Maria is what the database lets her see.

**Who sees what** (row-level security, at the end of `src/lib/db/schema.sql`):
- A practice's people (`practice_staff.user_id`) see every company it keeps.
- A client company's own people (`company_members`) see that company and
  nothing else, and none of the practice's records about it: its AML file,
  its fee, the time spent on it. Pixelforge's owner, Nikos Savva, is seeded to
  show it.
- Nobody signed in sees nothing. Only the database writes the audit trail.
- Every request from a person runs as the role `authenticated`, with their
  id in `request.jwt.claims`, as Supabase runs it (`src/lib/db/index.ts`).
  Work done for nobody in particular (a client's private link, the website
  form, the sanctions list refresh) runs inside `asService()`, which names why.
- `npm run check:tenancy` proves it: 27 checks, asked as a partner, as
  someone at another practice, as a client's owner and as nobody. Against a
  real Postgres: `DATABASE_URL=… CHECK_TENANCY_WIPE=1 npm run check:tenancy`
  (it empties that database first: a throwaway one only).

**Signing in** (`src/lib/auth`, `src/proxy.ts`, `src/app/(auth)`):
- Live, Supabase Auth: email and password, and an emailed link to set a new
  one. The proxy refreshes the session and sends anyone not signed in to
  `/sign-in`; who someone is, is verified (getClaims) where data is read.
- Nobody signs up on their own. A partner invites the practice's people
  (Practice settings → People); anyone at the practice, or a company's
  owner, invites a client company's own people (Company settings → People).
  The invitation's link (valid 14 days, kept only as a fingerprint) is where
  they make their account; it is proof the address is theirs.
- The laptop demo has no passwords: `/sign-in` lists its people. Sign in as
  Nikos Savva to see Ledgerline as a client's owner does.
- `tests/supabase-auth.spec.ts` drives the Supabase path through
  `@supabase/ssr` against `tests/support/stand-in-auth.mjs`, a stand-in for
  Supabase Auth's endpoints with a real Postgres behind it. It proves
  Ledgerline's side, not Supabase's: run it against the real project too.

**Setting it up**
1. Create a Supabase project in the Frankfurt region (eu-central-1).
2. `supabase link --project-ref …`, then `supabase db push`: it applies
   `supabase/migrations`, the baseline (generated from `schema.sql` by
   `npm run supabase:migration`) and the link to Supabase Auth.
3. Give the host (Vercel, EU region) the variables at the end of
   `.env.example`: `DATABASE_URL` (the transaction pooler, port 6543),
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `LEDGERLINE_SITE_URL`, and `ANTHROPIC_API_KEY`.
4. In Supabase Auth: turn off "Allow new users to sign up" (accounts come
   only from invitations), set the Site URL to `LEDGERLINE_SITE_URL`, and
   add `LEDGERLINE_SITE_URL/auth/callback` to the redirect URLs.
5. The Data API can stay on or be switched off: anonymous requests get
   nothing, and a signed-in one sees only what the rules allow.
6. The first practice and its first partner are made by Wolsten Studios
   (the admin console is still to come); everyone else is invited.

The whole test suite runs against any Postgres too:
`DATABASE_URL=… npx playwright test` (an empty, throwaway database; it is
rebuilt with the demo data). On 26 Oct it passed on Postgres 16. The
Supabase sign-in test, against the stand-in:
`DATABASE_URL=… node tests/support/stand-in-auth.mjs` in one terminal, then
build with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the
publishable key from `node tests/support/stand-in-auth.mjs --keys`, and run
`LEDGERLINE_AUTH_E2E=supabase npx playwright test tests/supabase-auth.spec.ts`
with the same variables and `SUPABASE_SECRET_KEY`. For a staging demo on a
real project, `npm run supabase:demo-users` gives the demo's people sign-ins.

**Still to do before the first practice signs up**
- The admin console for Wolsten Studios: every practice, its subscription
  (Stripe), suspending one, logged support access.
- Files into Supabase Storage: documents, logos and captures are kept in
  Postgres today.
- Next.js 16.4 or later: 16.3.3 has published security advisories.

## At a big practice's scale

`LEDGERLINE_DEMO_COMPANIES=400` builds the demo with that many client
companies: the eight, then variants of them, each with its own name, numbers,
bank account and fifteen months of books generated the same way, its CRM,
staff and file following the one it varies. Use it on a throwaway database:

```
DATABASE_URL=postgres://… LEDGERLINE_DEMO_DATA=1 LEDGERLINE_RESET_ON_START=1 LEDGERLINE_DEMO_COMPANIES=400 npm run start
```

Measured on 27 October 2026 with 400 clients on Postgres 16 (101,000 bank
lines, 365,000 journal lines, 20,000 invoices, 31,000 bills; built in 95
seconds): every company page answers in 15 to 45 ms, and the practice pages
(the dashboard, deadlines, calendar, fees, client files, capture) in under
0.6 s, with at most about 1,700 elements on screen. Before this, the
dashboard and deadlines took 47 seconds: each bank line's status was worked
out by valuing every match. A bank line now knows whether it is matched
(`bank_line_matched`), the dashboard works out VAT only for the clients on
screen, deadlines are looked up by company, and the practice pages list the
clients that need something first, forty to sixty at a time, with a search by
name, HE or VAT number.

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
- `src/lib/db/index.ts`: the embedded Postgres on the laptop, or `DATABASE_URL`
  for a real one; every query runs as the person asking (see Going live).
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
- The CRM (`src/app/(app)/c/[org]/crm`, `src/lib/data/crm.ts`, `src/lib/actions/crm.ts`):
  the pipeline (`crm_enquiries`), jobs (`crm_jobs`) and tasks, one CRM per
  company, wired to that company's customers and invoices. How each company
  works is `src/lib/domain/business-types.ts` (the ten kinds of business and
  what each sets up), `workspace_settings`, `crm_stages` (each board's stages,
  checked by `crm_stage_check`) and `custom_fields` (values in each record's
  `extra`); `src/lib/db/workspace-setup.ts` sets a company up, and
  **Customise** (`src/app/(app)/c/[org]/settings/workspace`,
  `src/lib/actions/workspace.ts`) changes it. The board is
  `src/components/crm/board.tsx` (HTML drag and drop; each card's own page
  moves it too, on a phone or with a keyboard).
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
- Client files (`src/app/clients`, `src/lib/domain/onboarding.ts`, `src/lib/data/clients.ts`,
  `src/lib/actions/clients.ts`): the steps, the risk method (ICPAC's client
  risk-based approach, 2024), the engagement letter's wording and fingerprint.
  The client's page is plain HTML at `/o/{token}` (`src/lib/clients`), signed
  and uploaded to with no script. Sanctions screening (`src/lib/domain/sanctions.ts`,
  `src/lib/sanctions.ts`) reads the EU's consolidated list; the seed loads a
  snapshot (`npm run sanctions:snapshot` refreshes it), and
  **Update the list** fetches the current one.
- Year end and audit (`src/app/(app)/c/[org]/year-end`, `src/lib/data/year-end.ts`,
  `src/lib/actions/year-end.ts`, `src/lib/domain/audit.ts`): the Cap. 113 tests,
  the steps and their dates, and the checks an auditor makes first. The audit
  file is `src/lib/documents/audit-file.ts`, zipped by `src/lib/documents/zip.ts`
  (files stored as they are, CRC-32 from Node's own zlib: no dependency).
  `npm run check:rules` checks the dates and tests against the law;
  `npx tsx scripts/check-tenancy.mts` checks that an auditor reads and never writes.
- Payroll (`src/app/(app)/c/[org]/payroll`, `src/lib/data/payroll.ts`,
  `src/lib/actions/payroll.ts`, `src/lib/domain/payroll-cy.ts`): employees,
  each month's run and its payslips. A month is worked out from each
  employee's pay and the year so far (brought forward, then every posted run);
  `post_payroll_run` posts it on approval. The payslips are
  `src/lib/documents/payslip-pdf.tsx`; the salary file is the SEPA writer with
  the SALA purpose.
- Calendar (`src/components/calendar`, `src/lib/data/calendar.ts`,
  `src/lib/domain/calendar.ts`): deadlines, tasks, invoices and quotes, read as
  the person asking. A subscribe link (`src/app/ics/[token]`,
  `src/lib/calendar-feeds.ts`) is a random token kept only as its SHA-256; a
  calendar app's request runs as the link's owner, under the same row-level
  security, and gets iCalendar from `src/lib/documents/ics.ts` (RFC 5545).
- Countries (`src/lib/domain/regimes.ts`): an organisation's `country` sets its
  currency, VAT rates (the database holds each line to them, `vat_rates()`), its
  chart (`chartFor`), its VAT periods (`vatPeriods`), return and deadlines.
  Amounts on a server page are in the currency of the company it is about
  (`requireOrg` sets it, `lib/format`); in the browser, `useCurrency()` from the
  company layout's `RegimeProvider`; a document keeps its own.
- Not in this demo: passwords (the laptop lists its people; live, Supabase
  Auth), currencies other than EUR, live bank feeds.
