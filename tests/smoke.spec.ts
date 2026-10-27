import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// These walk through the laptop demo, signed in as its own user; the Supabase sign-in has its own tests.
test.skip(process.env.LEDGERLINE_AUTH_E2E === "supabase", "The demo's journeys run without Supabase Auth");

const files = ["01-greek-marine-fuel-invoice.pdf", "02-two-invoices-in-one-pdf.pdf", "03-photographed-print-shop-invoice.jpg", "04-eu-reverse-charge-invoice.pdf"]
  .map(name => path.join(process.cwd(), "demo-files", name));

test("practice dashboard lists every client", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /8 clients/ })).toBeVisible();
  for (const name of ["Aegean Blue Marine Services Ltd", "Troodos Gold Olive Oil Ltd", "Kalamies Dental Clinic Ltd", "Larnaka Roast Coffee Co Ltd", "Pixelforge Studio Ltd", "Mesogeios Holdings Ltd",
    "Thames Edge Joinery Ltd", "Willow & Wren Design Ltd"]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
});

test("capture reads, routes and posts a mixed batch", async ({ page }) => {
  await page.goto("/capture");
  await page.locator("#capture-files").setInputFiles(files);
  await expect(page.getByText(/invoices? found, checked and routed/)).toHaveCount(4, { timeout: 60_000 });
  await expect(page.getByText("→ Larnaka Roast Coffee Co Ltd").first()).toBeVisible();
  await page.getByRole("button", { name: /Post all/ }).click();
  await expect(page.getByText(/bills posted to/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Posted from capture" })).toBeVisible();
});

test("bank reconciliation matches every sure line in one press", async ({ page }) => {
  await page.goto("/c/aegean-blue-marine/bank");
  await page.getByRole("link", { name: /Reconcile|Bank of Cyprus/ }).first().click();
  const matchAll = page.getByRole("button", { name: /Match all \d+/ });
  await expect(matchAll).toBeVisible();
  await matchAll.click();
  await expect(page.getByRole("button", { name: /Match all \d+/ })).toHaveCount(0, { timeout: 60_000 });
});

test("reports agree and the VAT return files and locks", async ({ page }) => {
  for (const report of ["profit-and-loss", "balance-sheet", "trial-balance", "general-ledger", "cash-flow"]) {
    await page.goto(`/c/aegean-blue-marine/reports/${report}`);
    await expect(page.getByText("We couldn’t load")).toHaveCount(0);
  }
  await page.goto("/c/aegean-blue-marine/reports/vat");
  await page.getByRole("button", { name: "Mark as filed and lock the period" }).click();
  await expect(page.getByText(/locked to the end of the period/)).toBeVisible();
  await page.goto("/c/aegean-blue-marine/audit");
  await expect(page.getByText("The chain is intact")).toBeVisible();
});

test("white label rebrands every screen", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Firm name").fill("Kyrenia Street Accountants");
  await page.getByLabel("Initials").fill("KS");
  await page.getByRole("button", { name: "Save the brand" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/compare");
  await expect(page.getByRole("link", { name: "Kyrenia Street Accountants dashboard" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Main navigation" }).getByText(/Powered by/)).toBeVisible();
});

test("each client has the CRM: to-dos, the pipeline in its own stages, and a won enquiry becomes a customer with its first job", async ({ page }) => {
  await page.goto("/c/larnaka-roast/crm");
  await expect(page.getByRole("heading", { name: "My to-dos" })).toBeVisible();
  await page.getByLabel("New to-do").fill("Call the roastery about the green coffee order");
  await page.getByLabel("New to-do").press("Enter");
  await expect(page.getByText("Call the roastery about the green coffee order")).toBeVisible();
  await page.goto("/c/larnaka-roast/crm/pipeline");
  await page.getByRole("region", { name: "Confirmed" }).getByRole("link").first().click();
  await page.getByRole("button", { name: "Mark as won" }).click();
  // A café and roastery's work is its orders: the new one opens with its first to-do, and the customer is in the books.
  await expect(page.getByText(/^Order #\d+/)).toBeVisible();
  await expect(page.getByText("Confirm the date and time with the customer")).toBeVisible();
  await page.getByRole("link", { name: "Raise an invoice" }).click();
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
});

test("a company's home puts the everyday actions first", async ({ page }) => {
  await page.goto("/c/larnaka-roast");
  const actions = page.getByRole("navigation", { name: "Everyday actions" });
  for (const name of ["Raise an invoice", "Record a bill", "Upload a receipt", "Money in", "Money out", "Write a quote"]) await expect(actions.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  // The switcher keeps the section: Invoices in one company opens Invoices in the next.
  await page.goto("/c/larnaka-roast/sales");
  await page.getByRole("button", { name: /Larnaka Roast/ }).click();
  await page.getByRole("link", { name: "Pixelforge Studio" }).click();
  await expect(page).toHaveURL(/\/c\/pixelforge\/sales$/);
});

test("an owner raises an invoice to a new customer, issues it, opens the PDF and records the payment", async ({ page }) => {
  await page.goto("/c/larnaka-roast");
  await page.getByRole("link", { name: /Raise an invoice/ }).click();
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption("new");
  await page.getByLabel("New customer's name").fill("Harbour View Apartments Ltd");
  await page.getByLabel("Line 1 description").fill("House espresso blend, 20 kg");
  await page.getByLabel("Line 1 unit price").fill("400");
  await expect(page.getByText("€476.00")).toBeVisible();
  await page.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByText("Issued and in the books.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Invoice LRC-2026-\d{4}$/ })).toBeVisible();

  const href = await page.getByRole("link", { name: "View PDF" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Line 1 unit price").fill("500");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("€595.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { name: "Paid in full" })).toBeVisible();
  await page.goto("/c/larnaka-roast/customers?q=Harbour");
  await expect(page.getByRole("link", { name: "Harbour View Apartments Ltd" })).toBeVisible();
});

test("a quote the customer accepts becomes an issued invoice with its lines", async ({ page }) => {
  await page.goto("/c/larnaka-roast/quotes");
  await page.getByRole("link", { name: "LRC-Q-002" }).click();
  await page.getByRole("button", { name: "Accepted: raise the invoice" }).click();
  await expect(page.getByText("Issued and in the books.")).toBeVisible();
  await expect(page.getByRole("link", { name: "LRC-Q-002" })).toBeVisible();
  await page.goto("/c/larnaka-roast/quotes?view=accepted");
  await expect(page.getByRole("link", { name: "LRC-Q-002" })).toBeVisible();
});

test("a receipt uploaded inside a company is read into that company's inbox", async ({ page }) => {
  await page.goto("/c/pixelforge/capture");
  await expect(page.getByRole("heading", { name: "Upload receipts", level: 1 })).toBeVisible();
  await page.locator("#capture-files").setInputFiles(files[2]);
  await expect(page.getByText(/invoices? found, checked and routed/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Lefkosia Print Shop").first()).toBeVisible();
});

test("a draft posts nothing until issued, and an unpaid invoice can be voided and restored", async ({ page }) => {
  await page.goto("/c/pixelforge/sales/new");
  // An EU business customer: reverse charge is chosen, and no VAT can be charged on the lines.
  await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption({ label: "Brabant Digital BV · NL859123455B01" });
  await expect(page.getByRole("combobox", { name: "VAT", exact: true })).toHaveValue("reverse_charge");
  await expect(page.getByLabel("Line 1 VAT rate")).toBeDisabled();
  await page.getByLabel("Line 1 description").fill("Design sprint, October");
  await page.getByLabel("Line 1 unit price").fill("3200");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("A draft: nothing is in the books until it is issued.")).toBeVisible();
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByRole("heading", { name: "To collect" })).toBeVisible();
  await expect(page.getByText("Reverse charge", { exact: true })).toBeVisible();
  // Issued and unpaid: it can still be edited, and saving reposts it.
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Line 1 unit price").fill("3500");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "To collect" })).toBeVisible();
  await expect(page.getByText("€3,500.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Void" }).click();
  await page.getByRole("button", { name: "Yes, void it" }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("heading", { name: "To collect" })).toBeVisible();
});

test("a product priced once fills an invoice line: quantity, unit price, discount and VAT worked out exactly", async ({ page }) => {
  await page.goto("/c/larnaka-roast/items/new");
  await page.getByLabel("Name").fill("Cold brew concentrate, 1 L");
  await page.getByLabel("Code").fill("CB-1L");
  await page.getByLabel("Price before VAT").fill("12.35");
  await page.getByLabel("VAT rate").selectOption("5");
  await page.getByRole("button", { name: "Add the product" }).click();
  await expect(page.getByText("Cold brew concentrate, 1 L added.")).toBeVisible();

  await page.goto("/c/larnaka-roast/sales/new");
  await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption({ label: "Coral Sands Hotel Ltd · CY10501127A" });
  await page.getByLabel("Line 1 description").fill("Cold brew concentrate, 1 L");
  await expect(page.getByLabel("Line 1 unit price")).toHaveValue("12.35");
  await expect(page.getByLabel("Line 1 VAT rate")).toHaveValue("5");
  await page.getByLabel("Line 1 quantity").fill("24");
  await page.getByRole("button", { name: "Give a discount" }).click();
  await page.getByLabel("Line 1 discount percent").fill("7.5");
  // 24 × 12.35 = 296.40, less 7.5% = 274.17; VAT at 5% = 13.71; total 287.88.
  await expect(page.getByLabel("Line 1 amount")).toHaveText("€274.17");
  await expect(page.getByText("€287.88")).toBeVisible();
  await page.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByText("Issued and in the books.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "€12.35" })).toBeVisible();
  await expect(page.getByText("€287.88").first()).toBeVisible();
});

test("a credit note from an invoice takes it off what is owed, and comes off the VAT due", async ({ page }) => {
  await page.goto("/c/larnaka-roast/sales?view=open");
  await page.getByRole("link", { name: /^LRC-2026-\d{4}$/ }).first().click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Credit note/ }).click();
  await expect(page.getByRole("heading", { name: "New credit note" })).toBeVisible();
  await page.getByLabel("Reason").selectOption("Price corrected");
  await page.getByLabel("Line 1 quantity").fill("1");
  await page.getByLabel("Line 1 unit price").fill("10");
  await page.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByText("Issued and in the books.")).toBeVisible();
  await expect(page.getByText(/came off invoice LRC-2026-\d{4}/)).toBeVisible();
  await page.getByRole("link", { name: /^LRC-2026-\d{4}$/ }).first().click();
  await expect(page.getByText(/€[\d,.]+ credited of €/)).toBeVisible();
  await expect(page.getByRole("link", { name: /^LRC-CN-2026-\d{4}$/ })).toBeVisible();
});

test("unused credit can be refunded from the bank, and the refund shows in the bank", async ({ page }) => {
  await page.goto("/c/pixelforge/credit-notes?view=unused");
  await page.getByRole("link", { name: "PF-CN-2026-0001" }).click();
  await expect(page.getByRole("heading", { name: "Credit to use" })).toBeVisible();
  await page.getByRole("button", { name: "Record the refund" }).click();
  await expect(page.getByRole("heading", { name: "Credit used" })).toBeVisible();
  await expect(page.getByText(/Refunded from/)).toBeVisible();
  await page.goto("/c/pixelforge/bank");
  await expect(page.getByText("Refunded").first()).toBeVisible();
  await page.goto("/c/pixelforge/reports/overview");
  await expect(page.getByText("Debtors agree")).toBeVisible();
});

test("a customer's statement is a PDF, and a reminder lists what is overdue", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/c/larnaka-roast/customers");
  await page.getByRole("link", { name: "Finikoudes Beach Kiosk Ltd" }).click();
  const statement = await page.getByRole("link", { name: "Statement" }).getAttribute("href");
  const pdf = await page.request.get(statement!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "Send a reminder" }).click();
  await expect(page.getByLabel("Message")).toHaveValue(/overdue/);
  await page.getByRole("button", { name: "Copy the message" }).click();
  await expect(page.getByText("Logged on the customer's timeline.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Payment reminder: /)).toBeVisible();
});

test("a sale paid on the spot is issued and paid in one step, and an invoice can be copied", async ({ page }) => {
  await page.goto("/c/larnaka-roast/sales/new");
  await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption("new");
  await page.getByLabel("New customer's name").fill("Walk-in event, Larnaca marina");
  await page.getByLabel("Line 1 description").fill("Barista coffee at events, per cup");
  await page.getByLabel("Line 1 quantity").fill("120");
  await page.getByLabel("Paid already").check();
  await page.getByRole("button", { name: "Save, issue and mark paid" }).click();
  await expect(page.getByRole("heading", { name: "Paid in full" })).toBeVisible();
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).replace("Invoice ", "");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Copy/ }).click();
  await expect(page.getByText(`A copy of ${number}`)).toBeVisible();
  await expect(page.getByLabel("Line 1 quantity")).toHaveValue("120");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("A draft: nothing is in the books until it is issued.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(`Invoice ${number}`);
});

test("an invoice's due date follows each customer's own payment terms", async ({ page }) => {
  await page.goto("/c/larnaka-roast/sales/new");
  const customer = page.getByRole("combobox", { name: "Customer", exact: true });
  await customer.selectOption({ label: "Coral Sands Hotel Ltd · CY10501127A" });
  await expect(page.getByText("30 days", { exact: true })).toBeVisible();
  const thirty = await page.getByLabel("Due date").inputValue();
  await customer.selectOption({ label: "Finikoudes Beach Kiosk Ltd · CY10472210X" });
  await expect(page.getByText("14 days", { exact: true })).toBeVisible();
  const fourteen = await page.getByLabel("Due date").inputValue();
  expect((Date.parse(thirty) - Date.parse(fourteen)) / 86_400_000).toBe(16);
});

test("repeating invoices: start one from an invoice, and raise what has come due in one press", async ({ page }) => {
  await page.goto("/c/larnaka-roast/repeating");
  await expect(page.getByText(/1 due:/)).toBeVisible();
  await page.getByRole("button", { name: "Raise 1 due invoice" }).click();
  await expect(page.getByText(/1 invoice raised: LRC-2026-\d{4}\./)).toBeVisible();
  await expect(page.getByText(/1 due:/)).toHaveCount(0);
  await page.getByRole("link", { name: "Espresso machine lease" }).click();
  await expect(page.getByRole("heading", { name: "Raised" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^LRC-2026-\d{4}$/ })).toBeVisible();

  await page.goto("/c/pixelforge/sales?view=all");
  await page.getByRole("link", { name: /^PF-2026-\d{4}$/ }).first().click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Repeat/ }).click();
  await page.getByLabel("How often").selectOption("3");
  await page.getByRole("button", { name: "Start repeating" }).click();
  await expect(page.getByText(/^Repeating\. The next invoice is due on/)).toBeVisible();
});

test("the VIES statement lists EU business customers by VAT number and agrees with box 8B", async ({ page }) => {
  await page.goto("/c/pixelforge/reports/vies?range=custom&from=2026-07-01&to=2026-09-30");
  await expect(page.getByRole("cell", { name: "298765435" })).toBeVisible();
  await expect(page.getByText(/Agrees with box 8B/)).toBeVisible();
});

test("an issued invoice downloads as a UBL e-invoice, and a company's documents carry its own logo and colour", async ({ page }) => {
  await page.goto("/c/pixelforge/sales?view=all&q=Nordlicht");
  await page.getByRole("link", { name: /^PF-2026-\d{4}$/ }).first().click();
  await page.getByRole("button", { name: "More actions" }).click();
  const href = await page.getByRole("menuitem", { name: /^E-invoice \(XML\)/ }).getAttribute("href");
  const xml = await page.request.get(href!);
  expect(xml.headers()["content-type"]).toContain("application/xml");
  const body = await xml.text();
  expect(body).toContain("urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0");
  expect(body).toContain("<cbc:ID>AE</cbc:ID>");
  expect(body).toContain("VATEX-EU-AE");

  await page.goto("/c/larnaka-roast/settings");
  await expect(page.getByRole("img", { name: "Logo" })).toBeVisible();
  await page.getByLabel("Terms at the foot").fill("Goods remain ours until paid for in full.");
  await page.getByRole("button", { name: "Save the design" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const logo = await page.request.get("/c/larnaka-roast/logo");
  expect(logo.headers()["content-type"]).toBe("image/png");
});

test("an issued invoice is sent from the owner's own email and recorded as sent", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/c/troodos-gold/sales/new");
  await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption({ label: "Nicosia Fine Foods Ltd · CY10144782P" });
  await page.getByLabel("Line 1 description").fill("Extra virgin olive oil, 750 ml");
  await page.getByLabel("Line 1 quantity").fill("120");
  await page.getByLabel("Their reference").fill("PO-2231");
  await page.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByText(/Not sent to Nicosia Fine Foods Ltd yet/)).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Message")).toHaveValue(/Please find attached invoice/);
  await page.getByRole("button", { name: "Copy the message" }).click();
  await expect(page.getByText("Marked as sent, and logged on the customer's timeline.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("PO-2231")).toBeVisible();
  await expect(page.getByText(/Not sent to/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();
});

test("a supplier's credit note from a bill comes off what is still to pay", async ({ page }) => {
  await page.goto("/c/larnaka-roast/bills?q=TD2610-032");
  await page.getByRole("link", { name: "Troodos Dairy Ltd" }).click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Supplier credit note/ }).click();
  await expect(page.getByRole("heading", { name: "Record a supplier's credit note" })).toBeVisible();
  await page.getByLabel("Their credit note number").fill("TD-CN-0412");
  await page.getByLabel("Line 1 net amount").fill("40");
  await page.getByRole("button", { name: "Record the credit note" }).click();
  await expect(page.getByText("Recorded and in the books.")).toBeVisible();
  await expect(page.getByText(/came off what is owed on TD2610-032/)).toBeVisible();
  await page.getByRole("link", { name: "TD2610-032" }).first().click();
  await expect(page.getByText(/credited of/)).toBeVisible();
});

test("several bills are paid at once, and the bank gets a SEPA file", async ({ page }) => {
  await page.goto("/c/larnaka-roast/bills");
  const boxes = page.getByRole("checkbox", { name: /^Pay / });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.getByText(/^2 bills chosen/)).toBeVisible();
  await page.getByRole("button", { name: "Pay them" }).click();
  await page.getByRole("button", { name: /^Pay 2 bills/ }).click();
  await expect(page.getByRole("heading", { name: /^Payment run/ })).toBeVisible();
  const href = await page.getByRole("link", { name: "Download the SEPA file" }).getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.headers()["content-type"]).toContain("application/xml");
  const xml = await file.text();
  expect(xml).toContain("urn:iso:std:iso:20022:tech:xsd:pain.001.001.03");
  expect(xml).toContain("<NbOfTxs>2</NbOfTxs>");
});

test("customers and products come in from a spreadsheet, and those already there are left alone", async ({ page }) => {
  await page.goto("/c/larnaka-roast/customers/import");
  await page.getByText("Or paste the rows").click();
  await page.getByLabel("Pasted rows").fill("Name,Email,VAT number,Country,Payment terms\nSeaview Cafe Ltd,accounts@seaview.example,CY10999991E,CY,21\nMarina Bistro Ltd,,,,\nCoral Sands Hotel Ltd,,CY10501127A,CY,30\nHarbour Grill Ltd,,CY10999991A,CY,\n");
  await expect(page.getByText("2 to add")).toBeVisible();
  await expect(page.getByText(/1 already there/)).toBeVisible();
  await expect(page.getByText(/1 with a problem/)).toBeVisible();
  await expect(page.getByText(/VAT number CY10999991A: the check letter of this Cyprus number doesn’t match/)).toBeVisible();
  await page.getByRole("button", { name: "Add 2 customers" }).click();
  await expect(page.getByText(/2 customers added\. 1 already there, left alone\. 1 row not imported\./)).toBeVisible();
  await page.goto("/c/larnaka-roast/customers?q=Seaview");
  await expect(page.getByRole("link", { name: "Seaview Cafe Ltd" })).toBeVisible();

  await page.goto("/c/larnaka-roast/items/import");
  await page.getByText("Or paste the rows").click();
  await page.getByLabel("Pasted rows").fill("Code;Name;Unit;Price;VAT rate\nCB-500;Cold brew, 500 ml;bottle;4,20;5%\n");
  await page.getByRole("button", { name: "Add 1 product" }).click();
  await expect(page.getByText(/1 product added/)).toBeVisible();
  await page.goto("/c/larnaka-roast/items");
  await expect(page.getByRole("link", { name: "Cold brew, 500 ml" })).toBeVisible();
});

test("a supplier's IBAN is checked before it is saved", async ({ page }) => {
  await page.goto("/c/larnaka-roast/suppliers");
  await page.getByRole("link", { name: "Ermou Street Properties Ltd" }).first().click();
  await page.getByLabel("IBAN").fill("CY12 0021 8116 2667 4713 0738 4396");
  await page.getByRole("button", { name: "Save supplier" }).click();
  await expect(page.getByText("That IBAN does not check out")).toBeVisible();
});

test("a journal is posted, edited, reversed in the next month and removed", async ({ page }) => {
  await page.goto("/c/troodos-gold/journals");
  await page.getByRole("link", { name: "New journal" }).click();
  await page.getByLabel("Narration").fill("Accrued electricity for October");
  await page.getByLabel("Line 1 account").selectOption({ label: "445 · Electricity and water" });
  await page.getByLabel("Line 1 debit").fill("312.40");
  await page.getByLabel("Line 2 account").selectOption({ label: "830 · Accruals" });
  await page.getByLabel("Line 2 credit").fill("312.40");
  await page.getByRole("button", { name: "Post journal" }).click();
  await expect(page.getByRole("heading", { name: "Accrued electricity for October", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Posted");

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Line 1 debit").fill("318.90");
  await page.getByLabel("Line 2 credit").fill("318.90");
  await page.getByRole("button", { name: "Save journal" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByRole("row", { name: /Balanced/ })).toContainText("€318.90");

  await page.getByRole("link", { name: "Reverse" }).click();
  await expect(page.getByRole("heading", { name: "Reverse a journal" })).toBeVisible();
  await expect(page.getByLabel("Date")).toHaveValue("2026-11-01");
  await expect(page.getByLabel("Line 1 credit")).toHaveValue("318.90");
  await page.getByRole("button", { name: "Post journal" }).click();
  await expect(page.getByRole("heading", { name: "Reversal of Accrued electricity for October", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Remove this journal" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.getByRole("status")).toContainText("removed from the books");
  await expect(page.getByRole("link", { name: "Accrued electricity for October" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Reversal of/ })).toHaveCount(0);
});

test("an enquiry sent from the company's website form lands in its pipeline, assigned, with a call-back due", async ({ page }) => {
  await page.goto("/c/larnaka-roast/crm/pipeline/form");
  const form = await page.getByRole("link", { name: "Open the form" }).getAttribute("href");
  expect(form).toMatch(/^\/f\/ll_form_[A-Za-z0-9]{24}$/);
  await page.goto(form!);
  await expect(page.getByRole("heading", { name: "Tell us what you need" })).toBeVisible();
  await page.getByLabel("Your name").fill("Eleni Charalambous");
  await page.getByLabel("Company").fill("Kypros Ferry Lines Ltd");
  await page.getByLabel("Email").fill("eleni@kyprosferry.example");
  await page.getByLabel("What do you need?").fill("Monthly bookkeeping and VAT");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();

  await page.goto("/c/larnaka-roast/crm/pipeline");
  const card = page.getByRole("link", { name: /Eleni Charalambous/ });
  await expect(card).toContainText("From your website");
  await card.click();
  await expect(page.getByText("Sent from the website form: Monthly bookkeeping and VAT.")).toBeVisible();
  await expect(page.getByText(/Call Eleni back \(Kypros Ferry Lines Ltd\)/)).toBeVisible();
});

test("the enquiries API takes JSON with a form key, refuses a wrong key, and a new key retires the old one", async ({ page }) => {
  await page.goto("/c/pixelforge/crm/pipeline/form");
  const token = (await page.getByRole("link", { name: "Open the form" }).getAttribute("href"))!.replace("/f/", "");
  const post = (key: string, data: Record<string, string>) => page.request.post("/api/v1/enquiries", { headers: { authorization: `Bearer ${key}` }, data });

  const created = await post(token, { name: "Annika Berg", company: "Fjordline Studio AS", email: "annika@fjordline.example", service: "VAT registration" });
  expect(created.status()).toBe(201);
  const body = await created.json();
  expect(body.reference).toMatch(/^P-2026-\d{4}$/);
  expect(body.next_action).toBe("Call Annika back");

  expect((await post("ll_form_wrongwrongwrongwrongwron", { name: "Someone", email: "a@b.example" })).status()).toBe(401);
  expect((await post(token, { company: "No name Ltd", email: "a@b.example" })).status()).toBe(422);
  expect((await post(token, { name: "Spam Bot", email: "bot@spam.example", _trap: "http://spam.example" })).status()).toBe(202);

  await page.reload();
  await expect(page.getByRole("link", { name: /Annika Berg Fjordline Studio AS API/ })).toBeVisible();
  await expect(page.getByText("Spam Bot")).toHaveCount(0);
  await page.getByRole("button", { name: "Make a new key" }).click();
  await expect(page.getByRole("link", { name: "Open the form" })).not.toHaveAttribute("href", `/f/${token}`);
  expect((await post(token, { name: "Too Late", email: "late@example.test" })).status()).toBe(401);
});

test("every client's deadlines are worked out from their books, and one that slipped is caught and closed", async ({ page }) => {
  await page.goto("/deadlines");
  await expect(page.getByRole("heading", { name: "Deadlines", level: 1 })).toBeVisible();
  await expect(page.getByText("VAT return, Jul–Sept 2026").first()).toBeVisible();
  const slipped = page.getByRole("listitem").filter({ hasText: "Provisional tax 2026, first instalment" }).filter({ hasText: "Kalamies Dental Clinic Ltd" });
  await expect(slipped).toContainText("overdue");
  await expect(slipped).toContainText("Sofia Georgiou");

  await page.goto("/c/kalamies-dental");
  await expect(page.getByRole("link", { name: /Provisional tax 2026, first instalment/ })).toBeVisible();
  await page.goto("/c/kalamies-dental/deadlines");
  await expect(page.getByText("Pixelforge Studio Ltd")).toHaveCount(0);
  await page.getByRole("listitem").filter({ hasText: "Provisional tax 2026, first instalment" }).getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Provisional tax 2026, first instalment" })).toContainText("Done");

  // What is still overdue is Mesogeios' AML review: a deadline of the practice's own, from the client file.
  await page.goto("/deadlines?view=overdue");
  await expect(page.getByText("Provisional tax 2026, first instalment")).toHaveCount(0);
  await expect(page.getByText("AML review, low risk")).toBeVisible();
});

test("a timer started on a client from the top bar runs, stops, and its time lands on the Time page", async ({ page }) => {
  await page.goto("/c/pixelforge");
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("combobox", { name: "For" })).toHaveValue(/.+/);
  await page.getByLabel("Working on").fill("VIES statement");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop the timer on Pixelforge Studio Ltd" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();

  await page.goto("/time");
  await expect(page.getByRole("heading", { name: "Time", level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Pixelforge Studio · VIES statement" }).first()).toContainText("0:01");
  await page.getByLabel("Work", { exact: true }).fill("Payroll");
  await page.getByLabel("How long").fill("1:15");
  await page.getByRole("button", { name: "Add the time" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "· Payroll" }).first()).toContainText("1:15");
});

test("each client's fee is set against its hours, and the month's fees are invoiced in one press, once", async ({ page }) => {
  await page.goto("/fees");
  const kalamies = page.getByRole("row").filter({ hasText: "Kalamies Dental Clinic Ltd" });
  await expect(kalamies).toContainText("Below your floor");
  await page.getByRole("button", { name: /^Raise .+’s fees/ }).click();
  await expect(page.getByRole("status")).toContainText("fee invoices raised");
  await expect(page.getByText(/’s fees are invoiced/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Raise .+’s fees/ })).toHaveCount(0);

  await page.getByRole("row").filter({ hasText: "Mesogeios Holdings Ltd" }).getByRole("link", { name: /^SAL-/ }).click();
  await expect(page.getByText(/Additional work, 3 hours at €90/)).toBeVisible();
  await expect(page.getByText(/Accounting services, /)).toBeVisible();

  // The app, resold under the firm's name, is its own line on the client's fee invoice.
  await page.goto("/fees");
  await expect(page.getByText(/6 clients pay you €150.00 a month for the app/)).toBeVisible();
  await page.getByRole("row").filter({ hasText: "Larnaka Roast Coffee Co Ltd" }).getByRole("link", { name: /^SAL-/ }).click();
  await expect(page.getByText(/Online books and invoicing, /)).toBeVisible();
});

test("an EU customer's VAT number is checked in VIES, and the answer is kept on the audit trail", async ({ page }) => {
  await page.goto("/c/pixelforge/customers?q=Atelier");
  await page.getByRole("link", { name: "Atelier Lumière SAS" }).first().click();
  await expect(page.getByText("Not checked in VIES yet.", { exact: false })).toBeVisible();

  await page.goto("/c/pixelforge/customers?q=Nordlicht");
  await page.getByRole("link", { name: "Nordlicht Software GmbH" }).first().click();
  await expect(page.getByText("Valid in VIES", { exact: true })).toBeVisible();
  await expect(page.getByText("Germany doesn’t disclose it")).toBeVisible();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText(/· for Pixelforge Studio Ltd$/)).toBeVisible();

  await page.goto("/c/pixelforge/audit");
  await expect(page.getByText("VAT number checked in VIES").first()).toBeVisible();
  await expect(page.getByText(/DE298765435: valid/).first()).toBeVisible();
});

test("a supplier registered in VIES under another name is flagged before it is relied on", async ({ page }) => {
  await page.goto("/c/pixelforge/suppliers");
  await page.getByRole("link", { name: "Nimbus Cloud Services BV" }).first().click();
  await page.getByRole("button", { name: "Check in VIES" }).click();
  await expect(page.getByText(/VIES has this number registered to STRATOCUMULUS HOSTING B\.V\., not Nimbus Cloud Services BV/)).toBeVisible();

  await page.getByLabel("VAT number", { exact: true }).fill("NL822334455B01");
  await page.getByRole("button", { name: "Save supplier" }).click();
  await expect(page.getByText(/The check digit of this Netherlands number doesn’t match/).first()).toBeVisible();
});

test("the practice checks any EU VAT number, sees every client's EU numbers, and re-checks them all at once", async ({ page }) => {
  await page.goto("/vat-numbers");
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Brabant Digital BV/ })).toContainText(/Last valid .*: check again/);
  await expect(table.getByRole("row", { name: /Atelier Lumière SAS/ })).toContainText("Not checked");

  await page.getByLabel("VAT number").fill("DE298765431");
  await expect(page.getByText(/The check digit of this Germany number doesn’t match/)).toBeVisible();
  await page.getByLabel("VAT number").fill("de 298 765 435");
  await expect(page.getByText("Germany: the shape and check digit are right. VIES will say whether it is registered.")).toBeVisible();
  await page.getByLabel("Checking for").selectOption({ label: "Pixelforge Studio Ltd" });
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Valid in VIES", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Check every number now" }).click();
  await expect(page.getByText(/^\d+ numbers checked against VIES just now/)).toBeVisible();
  await expect(table.getByRole("row", { name: /Brabant Digital BV/ })).toContainText(/^.*Valid, /);
  await expect(table.getByRole("row", { name: /Nimbus Cloud Services BV/ })).toContainText("Registered to STRATOCUMULUS HOSTING B.V.");
});

test("a new client is taken on: the letter signed through their link, everyone screened, the risk approved, then the books open", async ({ page, context }) => {
  await page.goto("/clients");
  await page.getByRole("link", { name: /Kypros Ferry Lines Ltd/ }).first().click();
  await page.getByRole("button", { name: "Send the engagement letter" }).click();
  await expect(page.getByText(/Waiting for Andreas Michaelides to sign/)).toBeVisible();
  const link = (await page.locator("pre").first().innerText()).trim();
  expect(link).toMatch(/\/o\/ll_cf_[A-Za-z0-9]{24}$/);

  const client = await context.newPage();
  await client.goto(link);
  await expect(client.getByRole("heading", { name: "Read and sign your engagement letter" })).toBeVisible();
  await client.getByLabel(/I am authorised/).check();
  await client.getByRole("button", { name: "Sign the letter" }).click();
  await expect(client.getByText("Thank you: the letter is signed. You can download a copy below.")).toBeVisible();
  const signed = await client.request.get(`${link}/letter.pdf`);
  expect(signed.headers()["content-type"]).toContain("application/pdf");
  await client.getByLabel("Alexander Petrov: proof of address, no more than six months old").setInputFiles({ name: "utility-bill.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await client.getByRole("listitem").filter({ hasText: "Alexander Petrov: proof of address" }).getByRole("button", { name: "Upload" }).click();
  await expect(client.getByText("Received. Thank you.")).toBeVisible();
  await client.close();

  await page.reload();
  await expect(page.getByText(/Signed by Andreas Michaelides, Director/)).toBeVisible();
  await page.getByRole("button", { name: "Screen everyone" }).click();
  await expect(page.getByText("2 possible matches")).toBeVisible();
  await expect(page.getByText("Alexander PETROV", { exact: true })).toBeVisible();
  await page.getByLabel("The reason for your decision").fill("Born 2 September 1984, Russian passport seen at our office: the listed persons were born in 1958 and 1979.");
  await page.getByRole("button", { name: "Record the decision" }).click();
  await expect(page.getByText(/Not the same person · decided by Maria Antoniou/)).toBeVisible();

  await expect(page.getByText(/Total 9 of 20/)).toBeVisible();
  await page.getByRole("button", { name: "Record the assessment" }).click();
  await page.getByRole("button", { name: "Approve as compliance officer" }).click();
  await expect(page.getByText(/Approved by Maria Antoniou as compliance officer/)).toBeVisible();
  await page.getByRole("button", { name: "Take them on: open the books" }).click();
  await expect(page).toHaveURL(/\/c\/kypros-ferry-lines\?opened=1$/);
  await expect(page.getByText(/Kypros Ferry Lines Ltd is taken on, and its books are open/)).toBeVisible();
  // Its Ledgerline is shaped as a shipping business's from the start: its clients and its jobs.
  await expect(page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Jobs" })).toBeVisible();

  await page.goto("/c/saltlake-accounting/audit");
  await expect(page.getByRole("row", { name: /Engagement letter signed/ })).toContainText("Andreas Michaelides (client)");
  await expect(page.getByText("Client taken on: books opened")).toBeVisible();
});

test("a politically exposed director makes a client high risk whatever the score, approved by a partner", async ({ page }) => {
  await page.goto("/clients/new");
  await page.getByLabel("Company name").fill("Akamas Wind Energy Ltd");
  await page.getByRole("button", { name: "Start the client file" }).click();
  await expect(page.getByRole("heading", { name: "Akamas Wind Energy Ltd" })).toBeVisible();
  await page.getByLabel("Full name, as on the passport").fill("Stavros Kleanthous");
  await page.getByLabel("Shares %").fill("100");
  await page.getByLabel("Politically exposed?").selectOption("pep");
  await page.getByLabel("The public function").fill("Member of the House of Representatives since 2021");
  await page.getByRole("button", { name: "Add the person" }).click();
  await expect(page.getByText(/Holding 100%, Stavros Kleanthous is recorded as a beneficial owner/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/High whatever the score: Stavros Kleanthous is a politically exposed person/)).toBeVisible();
  await page.getByRole("button", { name: "Record the assessment" }).click();
  await expect(page.getByText("Enhanced due diligence · total")).toBeVisible();
  await page.getByRole("button", { name: "Approve as partner" }).click();
  await expect(page.getByText(/Approved by Maria Antoniou as partner/)).toBeVisible();
});

test("each client's AML review is a deadline, and the file it opens shows the risk to review", async ({ page }) => {
  await page.goto("/deadlines");
  const review = page.getByRole("listitem").filter({ hasText: "AML review" }).filter({ hasText: "Mesogeios Holdings" });
  await expect(review).toContainText("7 days overdue");
  await review.getByRole("link", { name: "Open the file" }).click();
  await expect(page.getByRole("heading", { name: "Mesogeios Holdings Ltd" })).toBeVisible();
  await expect(page.getByText(/Approved by Maria Antoniou as compliance officer/)).toBeVisible();
  await page.goto("/clients");
  await expect(page.getByRole("row", { name: /Kalamies Dental Clinic/ })).toContainText("in 19 days");
});

test("signing in as a client's owner shows that company only, and signing out shuts Ledgerline", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: /Sign in as Nikos Savva/ }).click();
  await expect(page).toHaveURL(/\/c\/pixelforge$/);
  await expect(page.getByRole("heading", { name: "Pixelforge Studio Ltd" })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Main navigation" }).or(page.getByLabel("Main navigation"));
  await expect(menu.getByRole("link", { name: "Client files" })).toHaveCount(0);
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/c\/pixelforge$/);
  const other = await page.goto("/c/aegean-blue-marine");
  expect(other?.status()).toBe(404);

  await page.goto("/c/pixelforge");
  await page.getByRole("button", { name: /Nikos Savva: account/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fclients$/);
  await page.getByRole("button", { name: /Sign in as Maria Antoniou/ }).click();
  await expect(page).toHaveURL(/\/clients$/);
});

test("a partner invites an accountant, who joins from the link and sees the practice", async ({ page, browser }) => {
  await page.goto("/settings/people");
  await page.getByLabel("Name").fill("Eleni Ioannou");
  await page.getByLabel("Email").fill("Eleni@Saltlake.example");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("Eleni Ioannou is invited.")).toBeVisible();
  const link = (await page.locator("pre").first().innerText()).trim();
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{32}$/);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "eleni@saltlake.example" })).toContainText("Withdraw");

  const fresh = await browser.newContext();
  const joining = await fresh.newPage();
  await joining.goto(link);
  // The practice, by whatever name it has now (an earlier test rebrands it): not a company's books.
  await expect(joining.getByRole("heading", { name: /^Join [^’]+$/ })).toBeVisible();
  await joining.getByRole("button", { name: "Join as Eleni Ioannou" }).click();
  await expect(joining).toHaveURL(/\/\?joined=1$/);
  await expect(joining.getByRole("button", { name: /Eleni Ioannou: account/ })).toBeVisible();
  await joining.goto("/clients");
  await expect(joining.getByRole("heading", { name: "Client files" })).toBeVisible();
  // The link is spent.
  await joining.goto(link);
  await expect(joining.getByText("This invitation has been used.")).toBeVisible();
  await fresh.close();

  await page.goto("/settings/people");
  await expect(page.getByRole("listitem").filter({ hasText: "Eleni Ioannou" }).first()).toContainText("Signs in");
  await page.goto("/c/saltlake-accounting/audit");
  await expect(page.getByText("Invitation accepted: joined")).toBeVisible();
});

test("a client's owner is invited from the company, and sees only that company's books", async ({ page, browser }) => {
  await page.goto("/c/larnaka-roast/settings/people");
  await expect(page.getByText("Nobody at the company signs in yet")).toBeVisible();
  await page.getByLabel("Name").fill("Marios Georgiou");
  await page.getByLabel("Email").fill("marios@larnakaroast.example");
  await page.getByRole("button", { name: "Invite" }).click();
  const link = (await page.locator("pre").first().innerText()).trim();

  const fresh = await browser.newContext();
  const owner = await fresh.newPage();
  await owner.goto(link);
  await expect(owner.getByRole("heading", { name: /Join Larnaka Roast Coffee Co Ltd’s books/ })).toBeVisible();
  await owner.getByRole("button", { name: "Join as Marios Georgiou" }).click();
  await expect(owner).toHaveURL(/\/c\/larnaka-roast\?joined=1$/);
  await owner.goto("/");
  await expect(owner).toHaveURL(/\/c\/larnaka-roast$/);
  expect((await owner.goto("/c/pixelforge"))?.status()).toBe(404);
  await fresh.close();

  // Withdrawn, a link is dead.
  await page.goto("/c/larnaka-roast/settings/people");
  await expect(page.getByRole("listitem").filter({ hasText: "Marios Georgiou" })).toContainText("Owner");
  await page.getByLabel("Name").fill("Katerina Georgiou");
  await page.getByLabel("Email").fill("katerina@larnakaroast.example");
  await page.getByRole("button", { name: "Invite" }).click();
  const second = (await page.locator("pre").first().innerText()).trim();
  await page.reload();
  await page.getByRole("listitem").filter({ hasText: "katerina@larnakaroast.example" }).getByRole("button", { name: "Withdraw" }).click();
  await page.goto(second);
  await expect(page.getByText("This invitation was withdrawn.")).toBeVisible();
});

test("Registrar, payroll and employer's deadlines are worked out too, and an official extension says who moved the date", async ({ page }) => {
  await page.goto("/c/kalamies-dental/deadlines");
  await expect(page.getByText("Annual return (HE32), made up to 4 November 2026")).toBeVisible();
  await expect(page.getByText("Payroll returns, September 2026")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Employer’s return (TD7), 2025" })).toContainText("Extended from 31 May 2026 by the Tax Department");
  await page.getByRole("listitem").filter({ hasText: "Financial statements 2025 to the Registrar" }).getByRole("link", { name: "Open the year end" }).click();
  await expect(page.getByRole("heading", { name: "Year end and audit", level: 1 })).toBeVisible();
  await expect(page.getByText("Reviewed under ISRE 2400, as the law allows")).toBeVisible();
  await expect(page.getByRole("link", { name: "2025 · With the reviewer" })).toBeVisible();
});

test("the year end follows Cyprus company law: audited when the year before was over the limit, and the report dated after the board's approval", async ({ page }) => {
  await page.goto("/c/larnaka-roast/year-end");
  await expect(page.getByText("Must be audited")).toBeVisible();
  await expect(page.getByText("The year before: turnover €212,400 is over the €200,000 limit.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Laid before the annual general meeting" })).toContainText(/Was due 30 Sept? 2026/);

  await page.getByText("Record dates").click();
  await page.getByLabel("Approved by the board").fill("2026-10-20");
  await page.getByLabel("Report signed").fill("2026-10-19");
  await page.getByLabel("Opinion").selectOption("unmodified");
  await page.getByRole("button", { name: "Save dates" }).click();
  await expect(page.getByText("The report can’t be dated before the board approved the financial statements.")).toBeVisible();
  await page.getByLabel("Report signed").fill("2026-10-22");
  await page.getByRole("button", { name: "Save dates" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Auditor’s report signed" })).toContainText("Unmodified");
  await expect(page.getByRole("link", { name: "2025 · Signed" })).toBeVisible();

  await page.goto("/c/larnaka-roast/audit");
  await expect(page.getByText("Year end updated").first()).toBeVisible();
  await expect(page.getByText(/Report signed: 22 October 2026/).first()).toBeVisible();
});

test("a year's audit file downloads as one ZIP: trial balance, ledgers, open items, bank, VAT and the audit trail, with what was checked", async ({ page }) => {
  await page.goto("/c/aegean-blue-marine/year-end");
  await expect(page.getByRole("link", { name: "2025 · Filed" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download the audit file" }).click()]);
  expect(download.suggestedFilename()).toBe("Aegean Blue Marine Services Ltd audit file 2025.zip");
  const archive = fs.readFileSync(await download.path());
  expect(archive.subarray(0, 4).toString("hex")).toBe("504b0304");
  const text = archive.toString("utf8");
  for (const name of ["00 Read me.txt", "01 Trial balance at 2025-12-31.csv", "04 General ledger 2025.csv", "07 Receivables at 2025-12-31.csv", "12 Audit trail from 2025-01-01.csv"]) expect(text).toContain(name);
  expect(text).toContain("it balances");
  expect(text).toContain("the chain is intact");
  expect(text).toContain("Opinion: Unmodified, signed 16 April 2026.");
});

test("the auditor is invited to read a company's books: they see its year end and take the audit file, and the database refuses any change", async ({ page, browser }) => {
  await page.goto("/c/pixelforge/settings/people");
  await page.getByLabel("Name").fill("Andri Kition");
  await page.getByLabel("Email").fill("andri@kitionaudit.example");
  await page.getByLabel("Role").selectOption("auditor");
  await page.getByRole("button", { name: "Invite" }).click();
  const link = (await page.locator("pre").first().innerText()).trim();

  const fresh = await browser.newContext();
  const auditor = await fresh.newPage();
  await auditor.goto(link);
  await auditor.getByRole("button", { name: "Join as Andri Kition" }).click();
  await expect(auditor).toHaveURL(/\/c\/pixelforge\?joined=1$/);
  await auditor.goto("/c/pixelforge/year-end");
  await expect(auditor.getByText("You’re here as Pixelforge Studio Ltd’s auditor")).toBeVisible();
  await expect(auditor.getByText("Record dates")).toHaveCount(0);
  const [download] = await Promise.all([auditor.waitForEvent("download"), auditor.getByRole("link", { name: "Download the audit file" }).click()]);
  expect(download.suggestedFilename()).toBe("Pixelforge Studio Ltd audit file 2025.zip");
  await auditor.goto("/c/pixelforge/settings");
  await auditor.getByLabel("Lock date").fill("2026-10-01");
  await auditor.getByRole("button", { name: "Save settings" }).click();
  await expect(auditor.getByText("You can look at these books but not change them.")).toBeVisible();
  expect((await auditor.goto("/c/larnaka-roast"))?.status()).toBe(404);
  await fresh.close();
});

test("the sidebar runs customers first, then money, then reports and tax", async ({ page }) => {
  await page.goto("/c/kalamies-dental");
  const menu = page.getByRole("complementary", { name: "Main navigation" });
  await expect(menu.locator("p.ll-eyebrow")).toHaveText(["CRM", "Money", "Reports & tax"]);
  // In the clinic's own words: its patients and insurers, and its treatment plans.
  await expect(menu.getByRole("link")).toContainText(["Home", "Enquiries", "Patients and insurers", "Quotes", "Invoices", "Products", "Treatment plans", "Tasks", "Calendar", "Bank", "Upload receipts", "Bills", "Suppliers", "Payroll", "Reports", "VAT returns", "Deadlines", "Year end"]);
});

test("the calendar puts every client's deadlines on their days, and one client's everything", async ({ page }) => {
  await page.goto("/calendar?date=2026-11-01");
  await expect(page.getByRole("heading", { name: "November 2026" })).toBeVisible();
  // Across all clients it opens on the filing deadlines: the VAT returns for the quarter to September fall on 10 November.
  await expect(page.getByRole("navigation", { name: "Show" }).getByRole("link", { name: "Deadlines" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Agenda" }).click();
  await expect(page.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "AML review" }).filter({ hasText: "Mesogeios Holdings" })).toContainText("7 days overdue");
  await page.goto("/calendar?view=agenda&date=2026-11-09");
  await expect(page.getByRole("listitem").filter({ hasText: "VAT return, Jul–Sept 2026" }).filter({ hasText: "Aegean Blue Marine" })).toBeVisible();

  // One client: everything, invoices one by one.
  await page.goto("/calendar?client=kalamies-dental&view=agenda");
  await expect(page.getByRole("navigation", { name: "Show" }).getByRole("link", { name: "Everything" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("listitem").filter({ hasText: "Aegean Blue Marine" })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: /Invoice KDC-\S+ (due|overdue)/ }).first()).toBeVisible();
  await page.goto("/c/kalamies-dental/calendar?view=week&date=2026-10-26");
  await expect(page.getByRole("heading", { name: /26 Oct – 1 Nov 2026/ })).toBeVisible();
});

test("a calendar link subscribes Google, Outlook or Apple to the deadlines, readable without signing in, and a new link stops the old", async ({ page, playwright }) => {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Make a subscribe link" }).click();
  const first = (await page.locator("pre").first().innerText()).trim();
  expect(first).toMatch(/\/ics\/[A-Za-z0-9_-]{43}\.ics$/);
  const outside = await playwright.request.newContext();
  const feed = await outside.get(first);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const body = await feed.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("X-WR-CALNAME:Ledgerline · All clients · Deadlines");
  // Still open: what is done (an earlier test files Aegean's VAT return) stays out of the feed.
  expect(body).toMatch(/SUMMARY:Employer’s return \(TD7\)\\, 2025 · Kalamies Dental Clinic/);
  expect(body).not.toContain("Chase ");

  await page.reload();
  await expect(page.getByText(/You have a link showing deadlines/)).toBeVisible();
  await page.getByRole("button", { name: "Make a new link" }).click();
  const second = (await page.locator("pre").first().innerText()).trim();
  expect(second).not.toBe(first);
  expect((await outside.get(first)).status()).toBe(404);
  expect((await outside.get(second)).status()).toBe(200);
  await outside.dispose();
});

test("a UK client keeps its books in pounds, at UK rates, and its VAT return is HMRC's nine boxes", async ({ page }) => {
  await page.goto("/c/thames-edge-joinery/reports/vat?range=custom&from=2026-05-01&to=2026-07-31");
  await expect(page.getByText(/HMRC’s VAT return, box by box · GB341872692 · Standard accounting/)).toBeVisible();
  // Construction labour bought under the CIS domestic reverse charge: in boxes 1 and 4, so it nets to nothing, and in box 7.
  await expect(page.getByText(/Construction services under the CIS domestic reverse charge: £2,071.48 on £10,357.37/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "VAT return" })).toBeVisible();
  await expect(page.getByText("£2,896.97").first()).toBeVisible();
  await expect(page.getByText(/Filed on 3 Sept 2026; the period is locked/)).toBeVisible();

  // A bill: the UK's rates, and which reverse charge.
  await page.goto("/c/thames-edge-joinery/bills/new");
  await page.locator('select[name="supplier_id"]').selectOption({ label: "Wren Site Labour Ltd" });
  await page.locator('input[name="issued_on"]').fill("2026-10-15");
  await page.getByLabel("Line 1 description").fill("Labour, Kennet Wharf block B");
  await page.getByLabel("Line 1 account").selectOption({ label: "320 · Labour-only subcontractors (CIS)" });
  await page.getByLabel("Line 1 net amount").fill("1000");
  await expect(page.getByLabel("Line 1 VAT rate").locator("option")).toHaveText(["20%", "5%", "0%"]);
  await page.locator('select[name="reverse_charge_kind"]').selectOption("construction");
  await page.getByRole("button", { name: "Record bill" }).click();
  await expect(page.getByRole("heading", { name: /Wren Site Labour Ltd/ })).toBeVisible();
  await page.goto("/c/thames-edge-joinery/reports/vat?range=custom&from=2026-08-01&to=2026-10-31");
  await expect(page.getByText(/Construction services under the CIS domestic reverse charge: £2,251.60 on £11,258.02/)).toBeVisible();

  // Its deadlines are HMRC's and Companies House's.
  await page.goto("/c/thames-edge-joinery/deadlines");
  await expect(page.getByRole("listitem").filter({ hasText: "Annual accounts to Companies House, the year to 31 March 2026" })).toContainText("31 Dec");
  await expect(page.getByText("Corporation Tax for the year to 31 March 2026")).toBeVisible();
  await expect(page.getByText(/VAT return, Aug–Oct 2026/)).toBeVisible();
});

test("the Flat Rate Scheme: 12% of turnover with its VAT, and filing moves the rest of the VAT charged to the scheme's surplus", async ({ page }) => {
  await page.goto("/c/willow-wren-design/reports/vat?range=custom&from=2026-07-01&to=2026-09-30");
  await expect(page.getByText(/Flat Rate Scheme at 12%/).first()).toBeVisible();
  await expect(page.getByText(/12% of the VAT-inclusive turnover, £17,520.00: £2,102.40/)).toBeVisible();
  await page.getByRole("button", { name: "Mark as filed and lock the period" }).click();
  await expect(page.getByText(/Filed on \d+ \w+ 2026; the period is locked/)).toBeVisible();
  await page.goto("/c/willow-wren-design/journals");
  await expect(page.getByText(/Flat Rate Scheme: VAT charged less the 12% flat rate, 2026-07-01 to 2026-09-30/)).toBeVisible();

  // Its settings: the UK's labels, and its scheme.
  await page.goto("/c/willow-wren-design/settings");
  await expect(page.getByText("Unique Taxpayer Reference (UTR)")).toBeVisible();
  await expect(page.getByLabel("Flat Rate Scheme")).toHaveValue("12");
  await expect(page.getByLabel("VAT returns")).toHaveValue("quarterly");
});

test("a GB VAT number is held to its check digits, and the dashboard keeps euros and pounds apart", async ({ page }) => {
  await page.goto("/c/willow-wren-design/customers/new");
  await page.locator('input[name="name"]').fill("Bristol Bike Hire Ltd");
  await expect(page.locator('select[name="country"]')).toHaveValue("GB");
  await page.locator('input[name="vat_number"]').fill("GB341872693");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText(/check digits of this UK VAT number don’t match/)).toBeVisible();
  await page.locator('input[name="vat_number"]').fill("GB 341 8726 92");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText(/check digits of this UK VAT number don’t match/)).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByText(/€[\d,]+ · £[\d,]+/).first()).toBeVisible();
});

test("Cyprus payroll: a month worked out from the year so far, extra pay added, approved and posted, with its payslips, salary file and TD7 figures", async ({ page }) => {
  await page.goto("/c/aegean-blue-marine/payroll");
  await expect(page.getByRole("heading", { name: "Payroll", level: 1 })).toBeVisible();
  for (const name of ["Nikos Charalambous", "Andri Ioannou", "Marios Hadjigeorgiou", "Despina Stylianou"]) await expect(page.getByRole("link", { name })).toBeVisible();
  await page.getByRole("button", { name: "Run October 2026’s payroll" }).click();
  await expect(page.getByRole("heading", { name: "October 2026 payroll", level: 1 })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  // The salaries add up to what the bank has paid in wages each month.
  const total = page.getByRole("row", { name: /^Total/ });
  await expect(total).toContainText("€9,840.00");
  await expect(page.getByRole("heading", { name: "To pay by 30 Nov 2026" })).toBeVisible();

  await page.getByText("Overtime, a bonus or commission this month").click();
  await page.getByLabel("Employee").selectOption({ label: "Andri Ioannou" });
  await page.getByLabel("Extra pay this month").fill("250");
  await page.getByRole("button", { name: "Work it out again" }).click();
  await expect(total).toContainText("€10,090.00");

  await page.getByRole("button", { name: "Approve and post October 2026" }).click();
  await expect(page.getByText("Posted", { exact: true })).toBeVisible();
  const base = "/c/aegean-blue-marine/payroll/" + page.url().split("/").pop();
  const payslips = await page.request.get(`${base}/payslips`);
  expect(payslips.headers()["content-type"]).toBe("application/pdf");
  const sepa = await (await page.request.get(`${base}/sepa`)).text();
  expect(sepa).toContain("<CtgyPurp><Cd>SALA</Cd></CtgyPurp>");
  expect(sepa).toContain("<NbOfTxs>4</NbOfTxs>");
  expect(sepa).toContain("Salary October 2026");
  const figures = (await (await page.request.get(`${base}/figures`)).text()).trim().split("\n");
  expect(figures[0]).toContain("Insurable earnings");
  expect(figures).toHaveLength(5);

  await page.getByRole("link", { name: "Payroll", exact: true }).first().click();
  await expect(page.getByRole("row", { name: /October 2026/ })).toContainText("Posted");
  await expect(page.getByRole("button", { name: "Run November 2026’s payroll" })).toBeVisible();
  // A UK company's wages are coded from the bank: no Cyprus payroll there.
  await page.goto("/c/thames-edge-joinery");
  await expect(page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Payroll" })).toHaveCount(0);
});

test("each company's CRM is its own: a port agent's jobs carry the vessel and port, a clinic's are treatment plans, a holding company keeps opportunities", async ({ page }) => {
  const menu = page.getByRole("complementary", { name: "Main navigation" });
  await page.goto("/c/aegean-blue-marine/crm/jobs");
  await expect(menu.getByRole("link", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("region", { name: "In port" })).toContainText("Vassiliko");
  await page.getByRole("link", { name: /Tanker call at Vassiliko/ }).click();
  await expect(page.getByText("MT Meridian Grace", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Job #\d+ · Meridian Ship Management Ltd/)).toBeVisible();

  await page.goto("/c/kalamies-dental/crm/jobs");
  await expect(page.getByRole("heading", { name: "Treatment plans", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /Clear aligners/ }).click();
  await expect(page.getByText(/Keep clinical notes in your clinical records system/)).toBeVisible();

  await page.goto("/c/mesogeios-holdings/crm/pipeline");
  await expect(page.getByRole("heading", { name: "Opportunities", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Proposal" })).toContainText("Acquisition");
  await expect(menu.getByRole("link", { name: "Quotes" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Projects" })).toHaveCount(0);
});

test("deals are dragged along the board: to the next stage, and to lost with the reason", async ({ page }) => {
  await page.goto("/c/troodos-gold/crm/pipeline");
  const card = page.getByRole("region", { name: "New" }).getByRole("listitem").first();
  const title = (await card.locator("a > span").first().innerText()).split("\n")[0];
  await card.dragTo(page.getByRole("region", { name: "Samples sent" }));
  await expect(page.getByRole("region", { name: "Samples sent" })).toContainText(title);
  await page.reload();
  await expect(page.getByRole("region", { name: "Samples sent" })).toContainText(title);

  const next = page.getByRole("region", { name: "Samples sent" }).getByRole("listitem").filter({ hasText: title });
  await next.dragTo(page.getByLabel("Drop here: Lost"));
  await page.getByLabel(/Why was .* lost\?/).fill("Went with a cheaper Spanish oil");
  await page.getByRole("button", { name: "Mark as lost" }).click();
  await expect(page.getByRole("region", { name: "Samples sent" })).not.toContainText(title);
  await page.goto("/c/troodos-gold/crm/pipeline?view=list");
  await expect(page.getByRole("row", { name: new RegExp(title) })).toContainText("Went with a cheaper Spanish oil");
});

test("a company is set up its own way in Customise: its names, a stage of its own, and a detail on every card", async ({ page }) => {
  const menu = page.getByRole("complementary", { name: "Main navigation" });
  await page.goto("/c/troodos-gold/settings/workspace");
  await page.locator("input[name=job_one]").fill("Shipment");
  await page.locator("input[name=job_many]").fill("Shipments");
  await page.getByRole("button", { name: "Save the names" }).click();
  await expect(menu.getByRole("link", { name: "Shipments" })).toBeVisible();

  const stages = page.locator("section.ll-panel", { has: page.getByRole("heading", { name: "Shipments: the stages" }) });
  await stages.getByRole("button", { name: "Add a stage" }).click();
  await stages.getByLabel("Stage 4").fill("At the port");
  await stages.getByRole("button", { name: "Save the stages" }).click();
  await expect(stages.getByLabel("Stage 4")).toHaveValue("At the port");

  const adder = page.getByRole("group", { name: "Add a detail" });
  await adder.getByLabel("Kept on").selectOption({ label: "Shipments" });
  await adder.getByLabel("Name").fill("Pallets");
  await adder.getByLabel("Kind").selectOption({ label: "Number" });
  await adder.getByLabel("Show on the cards and in the list").check();
  await adder.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByText("Pallets", { exact: true })).toBeVisible();

  await page.goto("/c/troodos-gold/crm/jobs");
  await expect(page.getByRole("region", { name: "At the port" })).toBeVisible();
  await page.getByRole("link", { name: "New shipment" }).click();
  await page.getByLabel("Title").fill("Hotel supply, November");
  await page.getByLabel("Pallets").fill("4");
  await page.getByRole("button", { name: "Add the shipment" }).click();
  await expect(page.getByText(/^Shipment #\d+/)).toBeVisible();
  await page.goto("/c/troodos-gold/crm/jobs");
  await expect(page.getByRole("region", { name: "Received" }).getByRole("listitem").filter({ hasText: "Hotel supply, November" })).toContainText("4");
});

test("a practice with many clients switches company by typing: a few letters or a registration number, then Enter, from any page with Ctrl+K", async ({ page }) => {
  await page.goto("/c/kalamies-dental");
  await page.getByRole("button", { name: /Kalamies Dental/ }).first().click();
  await page.getByLabel("Find a company").fill("pixel");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/c\/pixelforge$/);
  await page.keyboard.press("Control+k");
  await page.getByLabel("Find a company").fill("412907");
  await expect(page.getByRole("dialog").getByRole("link")).toHaveText(/Aegean Blue Marine Services Ltd\s*HE 412907/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/c\/aegean-blue-marine$/);
  // The last ones opened come first next time.
  await page.getByRole("button", { name: /Aegean Blue/ }).first().click();
  await expect(page.getByRole("dialog").getByRole("link").nth(2)).toHaveText(/Pixelforge Studio Ltd/);
});

test("a big practice's dashboard puts the clients that need something first, yours apart, found by name or number; deadlines open on one day", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Yours · \d+/ }).click();
  await expect(page).toHaveURL(/\?view=mine$/);
  await page.getByRole("link", { name: /^All · \d+/ }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await page.getByLabel("Find a client").fill("412907");
  await page.getByLabel("Find a client").press("Enter");
  await expect(page).toHaveURL(/q=412907/);
  const table = page.getByRole("region", { name: "Clients" });
  await expect(table.getByRole("link", { name: /Aegean Blue Marine Services Ltd/ })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(2);

  await page.goto("/deadlines?due=2026-11-30");
  await expect(page.getByText(/^Due on 30 Nov 2026: \d+ deadlines?\./)).toBeVisible();
  await page.getByRole("link", { name: "Show every day" }).click();
  await expect(page).toHaveURL(/\/deadlines$/);
});

