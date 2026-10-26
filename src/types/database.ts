/**
 * Row shapes for the Ledgerline database (src/lib/db/schema.sql). Hand-kept,
 * with organisation_id on every books table.
 * Numeric columns arrive as numbers; dates as YYYY-MM-DD strings.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export const INVOICE_PAYMENT_METHODS = ["bank_transfer", "card", "cash", "cheque", "other"] as const;
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];

// The books (migration 20260930100000_accounting)
// ---------------------------------------------------------------------------

export const LEDGER_ACCOUNT_TYPES = [
  "bank", "current_asset", "fixed_asset", "current_liability", "non_current_liability",
  "equity", "revenue", "other_income", "direct_costs", "expense", "depreciation",
] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];
export const LEDGER_SYSTEM_ROLES = ["receivable", "payable", "vat", "sales", "retained_earnings"] as const;
export type LedgerSystemRole = (typeof LEDGER_SYSTEM_ROLES)[number];
export type LedgerAccountRow = {
  id: string; code: string; name: string; type: LedgerAccountType; system_role: LedgerSystemRole | null;
  description: string | null; bank_details: string | null; is_active: boolean; created_at: string; updated_at: string;
};
export type AccountingSettingsRow = {
  id: boolean; lock_date: string | null; default_bank_account_id: string | null; year_end_month: number;
  /** Whether bank lines and open invoices may be sent to the AI service for suggested matches (migration 20261007100000). */
  ai_suggestions: boolean;
  updated_by: string | null; updated_at: string; manager: string | null;
};
export type SupplierRow = {
  id: string; name: string; email: string | null; phone: string | null; vat_number: string | null; country: string;
  default_account_id: string | null; notes: string | null; is_active: boolean;
  /** A supplier abroad that charges no VAT: its new bills start as reverse charge (migration 20261008100000). */
  reverse_charge: boolean;
  /** Where the supplier is paid, for a SEPA payment file. */
  iban: string | null; bic: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export const BILL_STATUSES = ["awaiting_payment", "part_paid", "paid", "void"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
/** Written through save_bill(); `amount_paid` and `status` follow bill_payments. */
export type BillRow = {
  id: string; supplier_id: string; number: string | null; reference: string | null; issued_on: string; due_on: string | null;
  currency: string; net: number | string; vat_amount: number | string; total: number | string; amount_paid: number | string;
  /** Taken off by the supplier's credit notes. */
  amount_credited: number | string;
  status: BillStatus; notes: string | null; source_document: string | null; created_by: string; created_at: string; updated_at: string;
  /** The supplier charged no VAT; `reverse_charge_vat` is what the firm accounts for itself, due and reclaimed. `vat_amount` is then 0. */
  reverse_charge: boolean; reverse_charge_vat: number | string;
};
export const VAT_RATES = [19, 9, 5, 3, 0] as const;
export type BillLineRow = {
  id: string; bill_id: string; position: number; description: string; account_id: string;
  net: number | string; vat_rate: number | string; vat_amount: number | string;
};
export type BillPaymentRow = {
  id: string; bill_id: string; paid_on: string; amount: number | string; bank_account_id: string;
  method: InvoicePaymentMethod; reference: string | null; created_by: string; created_at: string;
};
export type BillDirectoryRow = BillRow & { balance: number | string; supplier_name: string; supplier_iban: string | null; days_overdue: number; search_text: string };
export const BANK_TRANSACTION_KINDS = ["spend", "receive", "transfer"] as const;
export type BankTransactionKind = (typeof BANK_TRANSACTION_KINDS)[number];
export type BankTransactionRow = {
  id: string; kind: BankTransactionKind; bank_account_id: string; transfer_account_id: string | null; txn_date: string;
  contact: string | null; reference: string | null; amount: number | string; net: number | string; vat_amount: number | string;
  /** Spending only: as on a bill, the VAT the firm accounts for itself. */
  reverse_charge: boolean; reverse_charge_vat: number | string;
  /** A refund of a customer's credit note: posts against receivables and has no lines. */
  credit_note_id: string | null;
  /** A refund received from a supplier against their credit note: posts against payables and has no lines. */
  supplier_credit_id: string | null;
  created_by: string; created_at: string; updated_at: string;
};
export type BankTransactionLineRow = {
  id: string; transaction_id: string; position: number; description: string; account_id: string;
  net: number | string; vat_rate: number | string; vat_amount: number | string;
};
export type BankTransactionDirectoryRow = BankTransactionRow & { bank_account_name: string; transfer_account_name: string | null };
export const JOURNAL_SOURCES = ["invoice", "invoice_payment", "bill", "bill_payment", "bank", "manual", "credit_note", "supplier_credit"] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];
/** Written only by the posting functions and save_manual_journal(). */
export type JournalEntryRow = {
  id: string; entry_date: string; source: JournalSource; source_id: string | null; reference: string | null;
  narration: string; created_by: string | null; created_at: string;
};
export type JournalLineRow = {
  id: string; entry_id: string; account_id: string; debit: number | string; credit: number | string;
  is_tax: boolean; description: string | null;
};
export type JournalLineViewRow = {
  id: string; entry_id: string; entry_date: string; source: JournalSource; source_id: string | null; reference: string | null;
  narration: string; account_id: string; account_code: string; account_name: string; account_type: LedgerAccountType;
  debit: number | string; credit: number | string; is_tax: boolean; description: string | null; created_at: string;
};
/** One row of ledger_balances(): debit-positive; closing = opening + debit − credit. */
export type LedgerBalanceRow = {
  account_id: string; code: string; name: string; type: LedgerAccountType; system_role: LedgerSystemRole | null; is_active: boolean;
  opening: number | string; debit: number | string; credit: number | string;
};
/** One row of cash_movements(): positive is money into the bank. */
export type CashMovementRow = {
  account_id: string; code: string; name: string; type: LedgerAccountType; system_role: LedgerSystemRole | null; amount: number | string;
};
export type VatSummaryRow = { output_vat: number | string; input_vat: number | string; sales_net: number | string; purchases_net: number | string };
/** Sales by VAT treatment, net, and services bought under the reverse charge with the VAT accounted for on them. */
export type VatBreakdownRow = {
  standard_sales: number | string; zero_rated_sales: number | string; exempt_sales: number | string; reverse_charge_sales: number | string; outside_scope_sales: number | string;
  reverse_charge_purchases: number | string; reverse_charge_vat: number | string;
};

// ---------------------------------------------------------------------------
// Bank statements and reconciliation (migration 20261007100000_bank_reconciliation)
// ---------------------------------------------------------------------------

export const STATEMENT_SOURCES = ["file", "feed"] as const;
export type StatementSource = (typeof STATEMENT_SOURCES)[number];
/** Written only through import_bank_statement() and delete_bank_statement_import(). */
export type BankStatementImportRow = {
  id: string; bank_account_id: string; source: StatementSource; file_name: string | null; added: number; skipped: number;
  first_date: string | null; last_date: string | null; closing_balance: number | string | null; imported_by: string | null; imported_at: string;
};
/** What the bank says happened; never posted. Money in is positive. */
export type BankStatementLineRow = {
  id: string; bank_account_id: string; import_id: string | null; txn_date: string; amount: number | string; description: string;
  reference: string | null; counterparty: string | null; balance: number | string | null; external_id: string;
  excluded_at: string | null; excluded_by: string | null; excluded_reason: string | null; created_at: string;
};
export const BANK_LINE_STATUSES = ["unmatched", "partial", "matched", "excluded"] as const;
export type BankLineStatus = (typeof BANK_LINE_STATUSES)[number];
export type BankStatementLineViewRow = BankStatementLineRow & { matched_amount: number | string; match_count: number; status: BankLineStatus };
/** Written only through reconcile_bank_line() and unmatch_bank_line(). Exactly one document is set. */
export type BankLineMatchRow = {
  id: string; line_id: string; bank_account_id: string; invoice_payment_id: string | null; bill_payment_id: string | null;
  bank_transaction_id: string | null; matched_by: string | null; matched_at: string;
};
export type BankDocumentKind = "invoice_payment" | "bill_payment" | "bank_transaction";
/** One row of unreconciled_bank_items(): recorded as going through the account, not yet on a statement. */
export type UnreconciledBankItemRow = {
  kind: BankDocumentKind; id: string; item_date: string; amount: number | string; label: string; reference: string | null;
  /** The invoice, bill or bank transaction to open for it. */
  document_id: string;
};
export const FEED_STATUSES = ["pending", "active", "expired", "error"] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];
export type BankFeedConnectionRow = {
  id: string; bank_account_id: string; provider: "enable_banking"; aspsp_name: string; aspsp_country: string; status: FeedStatus;
  auth_state: string | null; session_id: string | null; account_uid: string | null; account_label: string | null;
  /** While an account is being chosen: what the bank's session opened, labels masked. */
  accounts: { uid: string; label: string }[];
  valid_until: string | null; last_synced_at: string | null; last_error: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
/** One item of reconcile_bank_line()'s p_items. */
export type BankMatchItem =
  | { kind: "invoice"; invoice_id: string; amount: number }
  | { kind: "bill"; bill_id: string; amount: number }
  | { kind: "spend" | "receive"; contact?: string | null; lines: { description: string; account_id: string; net: number; vat_rate: number; vat_amount: number }[] }
  | { kind: "transfer"; account_id: string }
  | { kind: BankDocumentKind; id: string };


// ---------------------------------------------------------------------------
// Ledgerline: the practice, its clients, sales and capture
// ---------------------------------------------------------------------------

export type PracticeRow = { id: string; name: string; initials: string; brand_color: string; tagline: string | null; fee_floor: number; created_at: string };
export type OrganisationRow = {
  id: string; practice_id: string; slug: string; name: string; greek_name: string | null; industry: string; he_number: string | null;
  vat_number: string | null; tic: string | null; vat_registered: boolean; vat_quarter_end_month: number; year_end_month: number;
  lock_date: string | null; default_bank_account_id: string | null; ai_suggestions: boolean; contact_name: string | null;
  contact_email: string | null; address: string | null; invoice_prefix: string; payment_terms_days: number;
  /** The colour of its documents' headings and totals, and the terms printed at their foot. */
  invoice_accent: string; invoice_footer: string | null; manager: string | null; is_practice: boolean;
  /** The first month kept in Ledgerline, for a company whose books were opened before anything was posted. */
  books_from: string | null; created_at: string;
};
export type CustomerRow = { id: string; organisation_id: string; name: string; email: string | null; phone: string | null; vat_number: string | null; country: string; address: string | null; eu_business: boolean; default_account_id: string | null;
  /** Days to pay; the company's terms when null. */
  payment_terms_days: number | null; is_active: boolean };
export const INVOICE_STATUSES = ["draft", "issued", "part_paid", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const VAT_TREATMENTS = ["standard", "exempt", "reverse_charge", "outside_scope"] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];
export type InvoiceRow = {
  id: string; organisation_id: string; customer_id: string; number: string; issued_on: string; due_on: string | null; currency: string;
  vat_treatment: VatTreatment; net: number; vat_amount: number; total: number; amount_paid: number;
  /** Taken off by credit notes set against it. */
  amount_credited: number; status: InvoiceStatus; notes: string | null; created_at: string;
  /** Raised by a repeating invoice. */
  repeating_id: string | null;
  /** The customer's own reference, such as a purchase order number. */
  reference: string | null;
  /** When it was last sent to the customer, and to whom. */
  sent_at: string | null; sent_to: string | null;
};
export type InvoiceDirectoryRow = InvoiceRow & { balance: number; client_name: string; client_vat_number: string | null; client_country: string; days_overdue: number };
/** A line as sold: a single amount (no unit price), or a quantity at a unit price less a discount. */
export type ItemisedLine = { item_id: string | null; unit: string | null; quantity: number; unit_price: number | null; discount_pct: number };
export type InvoiceLineRow = { id: string; invoice_id: string; position: number; description: string; account_id: string; net: number; vat_rate: number; vat_amount: number } & ItemisedLine;
/** A product or service the company sells, priced once. */
export type ItemRow = { id: string; organisation_id: string; code: string | null; name: string; description: string | null; unit: string | null; unit_price: number; vat_rate: number; account_id: string; is_active: boolean; created_at: string };
export const CREDIT_NOTE_STATUSES = ["draft", "issued", "void"] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];
export type CreditNoteRow = {
  id: string; organisation_id: string; customer_id: string; invoice_id: string | null; number: string; issued_on: string; vat_treatment: VatTreatment; reason: string;
  net: number; vat_amount: number; total: number; amount_allocated: number; amount_refunded: number; status: CreditNoteStatus; notes: string | null; created_at: string;
};
/** The same invoice raised every month, quarter or year; `lines` are as save_invoice takes them. */
export type RepeatingInvoiceRow = {
  id: string; organisation_id: string; customer_id: string; name: string; every_months: 1 | 2 | 3 | 6 | 12; day_of_month: number; next_on: string; ends_on: string | null;
  issue: boolean; vat_treatment: VatTreatment; notes: string | null; lines: Record<string, unknown>[]; is_active: boolean; raised: number; last_invoice_id: string | null; created_at: string;
};
/** A credit note from a supplier, recorded as they sent it. */
export type SupplierCreditRow = {
  id: string; organisation_id: string; supplier_id: string; bill_id: string | null; number: string | null; issued_on: string; net: number; vat_amount: number; total: number;
  reverse_charge: boolean; reverse_charge_vat: number; amount_allocated: number; amount_refunded: number; status: "recorded" | "void"; notes: string | null; created_at: string;
};
export type SupplierCreditDirectoryRow = SupplierCreditRow & { remaining: number; supplier_name: string; bill_number: string | null };
export type CreditNoteDirectoryRow = CreditNoteRow & { remaining: number; client_name: string; client_vat_number: string | null; client_country: string; invoice_number: string | null };
