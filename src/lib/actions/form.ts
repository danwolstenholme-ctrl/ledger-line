import "server-only";

import type { ActionState } from "@/lib/actions/state";

/**
 * Minimal form parsing and validation.
 *
 * Deliberately not a schema library. The whole surface is a dozen fields of
 * text, enum, money and date, and hand-rolling that is smaller than the
 * dependency it would replace — see the dependency policy in
 *
 * Every parser returns a value or records a field error; nothing throws, so a
 * form can report all of its problems in one pass rather than one at a time.
 */

export type { ActionState } from "@/lib/actions/state";

export class FormParser {
  readonly errors: Record<string, string> = {};

  constructor(private readonly data: FormData) {}

  private raw(name: string): string {
    const value = this.data.get(name);
    return typeof value === "string" ? value.trim() : "";
  }

  text(name: string, options: { required?: boolean; max?: number; label?: string } = {}) {
    const { required = false, max = 500, label = name } = options;
    const value = this.raw(name);
    if (!value) {
      if (required) this.errors[name] = `${label} is required.`;
      return null;
    }
    if (value.length > max) {
      this.errors[name] = `${label} must be ${max} characters or fewer.`;
      return null;
    }
    return value;
  }

  email(name: string, options: { required?: boolean } = {}) {
    const value = this.text(name, { required: options.required, max: 320, label: "Email" });
    if (!value) return null;
    // Deliberately loose. Real addresses are stranger than most patterns allow,
    // and the database check is the same shape.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      this.errors[name] = "That does not look like an email address.";
      return null;
    }
    return value;
  }

  enum<T extends string>(
    name: string,
    allowed: readonly T[],
    options: { required?: boolean; fallback?: T; label?: string } = {},
  ): T | null {
    const value = this.raw(name);
    if (!value) {
      if (options.required && options.fallback === undefined) {
        this.errors[name] = `${options.label ?? name} is required.`;
      }
      return options.fallback ?? null;
    }
    if (!allowed.includes(value as T)) {
      this.errors[name] = `${options.label ?? name} is not a recognised value.`;
      return options.fallback ?? null;
    }
    return value as T;
  }

  /** Money as a plain number. Rejects negatives; the database does too. */
  money(name: string, label = "Amount"): number | null {
    const value = this.raw(name).replace(/[,\s]/g, "");
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      this.errors[name] = `${label} must be a number.`;
      return null;
    }
    if (parsed < 0) {
      this.errors[name] = `${label} cannot be negative.`;
      return null;
    }
    if (parsed > 99_999_999) {
      this.errors[name] = `${label} is implausibly large.`;
      return null;
    }
    return Math.round(parsed * 100) / 100;
  }

  /** A `datetime-local` value, already converted to a UTC instant upstream. */
  isoDate(name: string, label = "Date"): string | null {
    const value = this.raw(name);
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      this.errors[name] = `${label} is not a valid date.`;
      return null;
    }
    return parsed.toISOString();
  }

  /** A profile id, or null for "unassigned". */
  uuid(name: string): string | null {
    const value = this.raw(name);
    if (!value || value === "unassigned" || value === "none") return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      this.errors[name] = "That is not a valid selection.";
      return null;
    }
    return value;
  }

  boolean(name: string) {
    const value = this.raw(name);
    return value === "on" || value === "true" || value === "1";
  }

  get failed() {
    return Object.keys(this.errors).length > 0;
  }

  fail(message = "Please correct the highlighted fields."): ActionState {
    return { ok: false, error: message, fieldErrors: this.errors };
  }
}

/**
 * Turns a Postgres error into something a person can act on, without leaking
 * row contents into the browser.
 */
export function describeDbError(
  error: { code?: string; message: string },
  fallback: string,
): string {
  switch (error.code) {
    case "23514": // check_violation
      if (error.message.includes("leads_next_action_pair")) {
        return "A next action needs both a description and a date, or neither.";
      }
      if (error.message.includes("leads_lost_reason_required")) {
        return "An enquiry cannot be marked lost without a reason.";
      }
      if (error.message.includes("tasks_completion_consistent")) {
        return "That task's completion state is inconsistent. Reload and try again.";
      }
      if (error.message.includes("invoices_not_overpaid")) {
        return "That is more than the balance still owed on this invoice.";
      }
      if (error.message.includes("invoice_payment_closed")) {
        return "A void or draft invoice cannot take a payment.";
      }
      if (error.message.includes("invoice_payment_future")) {
        return "A payment cannot be dated in the future.";
      }
      if (error.message.includes("invoice_has_payments")) {
        return "This invoice has a payment or a credit against it, so it can no longer be edited. Raise a credit note to correct it.";
      }
      // Credit notes.
      if (error.message.includes("credit_exceeds_invoice")) {
        const number = error.message.match(/invoice (\S+)/)?.[1];
        return `That is more than is left to credit on invoice ${number ?? "it corrects"}. Credit notes can never add up to more than the invoice.`;
      }
      if (error.message.includes("credit_notes_not_overused")) {
        return "That is more than the credit left on this credit note.";
      }
      if (error.message.includes("credit_customer")) {
        return "A credit can only go against the same customer's invoices.";
      }
      if (error.message.includes("credit_invoice")) {
        return "A credit note corrects an issued invoice to the same customer.";
      }
      if (error.message.includes("credit_note_refunded")) {
        return "This credit has been refunded. Remove the refund before voiding the credit note.";
      }
      if (error.message.includes("credit_note_closed")) {
        return "That is not possible for this credit note as it stands. Reload and try again.";
      }
      if (error.message.includes("bank_refund")) {
        return "A refund is changed from its credit note, not from the bank.";
      }
      if (error.message.includes("ledger_line_quantity")) {
        return "Each line needs a quantity above zero, a price, and a discount under 100%.";
      }
      if (error.message.includes("ledger_line_net")) {
        return "A line's amount must be its quantity times its price, less any discount.";
      }
      // Suppliers' credit notes.
      if (error.message.includes("credit_exceeds_bill")) {
        return "That is more than is left to credit on this bill. Credit notes can never add up to more than the bill.";
      }
      if (error.message.includes("supplier_credits_not_overused")) {
        return "That is more than the credit left on this credit note.";
      }
      if (error.message.includes("credit_supplier")) {
        return "A supplier's credit can only go against their own bills.";
      }
      if (error.message.includes("credit_bill")) {
        return "A supplier's credit note corrects one of that supplier's bills.";
      }
      if (error.message.includes("supplier_credit_refunded")) {
        return "This credit has been refunded. Remove the refund first.";
      }
      if (error.message.includes("supplier_credit_closed")) {
        return "That is not possible for this credit note as it stands. Reload and try again.";
      }
      if (error.message.includes("suppliers_iban_check")) {
        return "That IBAN is not in the right form.";
      }
      if (error.message.includes("suppliers_bic_check")) {
        return "That BIC is not in the right form: 8 or 11 letters and digits.";
      }
      if (error.message.includes("repeat_not_due")) {
        return "That repeating invoice is not due yet.";
      }
      if (error.message.includes("ledger_line_item")) {
        return "One of the products is not this company's. Choose it again from the list.";
      }
      if (error.message.includes("invoice_paid_by_ledger")) {
        return "Record a payment rather than changing the paid amount.";
      }
      if (error.message.includes("invoices_due_after_issue")) {
        return "The due date cannot be before the invoice date.";
      }
      if (error.message.includes("must be billed to that matter")) {
        return "That matter belongs to a different client. Choose one of this client’s matters.";
      }
      if (error.message.includes("invoice_lines")) {
        return "Each invoice line needs a description and an amount.";
      }
      // The books.
      if (error.message.includes("period_locked")) {
        const date = error.message.match(/\d{4}-\d{2}-\d{2}/)?.[0];
        return `The books are locked${date ? ` up to ${date.split("-").reverse().join("/")}` : ""}. Move the lock date in the company's Settings to change it.`;
      }
      if (error.message.includes("ledger_line_account")) {
        return "A line cannot be coded to a bank, receivable, payable or VAT account. Choose what the money was for.";
      }
      if (error.message.includes("ledger_vat_amount")) {
        return "The VAT on a line does not match its rate. Check each line's VAT figure.";
      }
      if (error.message.includes("ledger_vat_rate")) {
        return "Use one of the Cyprus VAT rates: 19%, 9%, 5%, 3% or 0%.";
      }
      if (error.message.includes("ledger_lines_required")) {
        return "Each line needs a description, an account and an amount.";
      }
      if (error.message.includes("ledger_bank_required")) {
        return "Choose an active bank account.";
      }
      if (error.message.includes("ledger_amount_required")) {
        return "Enter the amount to transfer.";
      }
      if (error.message.includes("ledger_system_account")) {
        return "That account is used by the books automatically, so its type cannot change and it stays active.";
      }
      if (error.message.includes("journal_unbalanced")) {
        return "The debits and credits must add up to the same amount.";
      }
      if (error.message.includes("journal_lines_required")) {
        return "A journal needs at least two lines.";
      }
      if (error.message.includes("journal_line_side")) {
        return "Each journal line needs either a debit or a credit, not both.";
      }
      if (error.message.includes("journal_line_account")) {
        return "Each journal line needs an active account.";
      }
      if (error.message.includes("journal_narration_required")) {
        return "Say what the journal is for.";
      }
      if (error.message.includes("bills_not_overpaid")) {
        return "That is more than the balance still owed on this bill.";
      }
      if (error.message.includes("bill_payment_future")) {
        return "A payment cannot be dated in the future.";
      }
      if (error.message.includes("bill_payment_closed")) {
        return "A void bill cannot be paid.";
      }
      if (error.message.includes("bill_has_payments")) {
        return "This bill has payments recorded. Remove them before changing or voiding it.";
      }
      if (error.message.includes("quote_closed")) {
        return "This quote is already accepted or declined, so it cannot change.";
      }
      if (error.message.includes("bill_closed")) {
        return "This bill is void. Restore it before changing it.";
      }
      if (error.message.includes("bills_due_after_issue")) {
        return "The due date cannot be before the bill date.";
      }
      if (error.message.includes("bank_match_total")) {
        const [matched, line] = error.message.match(/-?\d+(?:\.\d+)?/g) ?? [];
        return matched && line ? `What you chose comes to €${Math.abs(Number(matched)).toFixed(2)}, but the bank line is €${Math.abs(Number(line)).toFixed(2)}. Adjust the amounts so they match.` : "What you chose does not add up to the bank line.";
      }
      if (error.message.includes("bank_match_account")) {
        return "Something you chose went through a different bank account.";
      }
      if (error.message.includes("bank_match_items")) {
        return "Choose what this bank line was.";
      }
      if (error.message.includes("bank_line_matched")) {
        return "This line is already matched. Unmatch it first.";
      }
      if (error.message.includes("bank_line_excluded")) {
        return "This line was set aside. Include it again before matching it.";
      }
      if (error.message.includes("bank_statement_lines")) {
        return "The file has no lines to import, or more than 5,000.";
      }
      if (error.message.includes("bank_statement_line")) {
        const position = error.message.match(/line (\d+)/)?.[1];
        return `Line ${position ?? "?"} of the statement has no readable date, amount or description.`;
      }
      return "That change could not be saved. Review the information and try again.";
    case "23505":
      if (error.message.includes("invoices_organisation_id_number")) return "Another invoice already has that number. Use the next one.";
      if (error.message.includes("quotes_organisation_id_number")) return "Another quote already has that number. Use the next one.";
      if (error.message.includes("credit_notes_organisation_id_number")) return "Another credit note already has that number. Use the next one.";
      if (error.message.includes("items_code_unique")) return "Another product already uses that code.";
      if (error.message.includes("items_name_unique")) return "There is already a product with that name.";
      if (error.message.includes("supplier_credits_number_unique")) return "That credit note from this supplier is already recorded.";
      if (error.message.includes("ledger_accounts_code") || error.message.includes("ledger_accounts_organisation_id_code")) return "Another account already uses that code.";
      if (error.message.includes("suppliers_name_unique")) return "There is already a supplier with that name.";
      if (error.message.includes("bills_supplier_number_unique")) return "This supplier's invoice with that number is already recorded.";
      if (error.message.includes("bank_line_matches_")) return "That payment or entry is already matched to another bank line.";
      return "That record already exists.";
    case "23503":
      return "That refers to something that no longer exists. Reload and try again.";
    case "42501":
      // Row-level security refusing a write: someone who may read these books, not change them.
      if (error.message.includes("row-level security")) return "You can look at these books but not change them.";
      return "You do not have permission to do that.";
    default:
      return fallback;
  }
}
