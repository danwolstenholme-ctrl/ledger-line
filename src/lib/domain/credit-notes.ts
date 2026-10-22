/** Why a credit note was issued: printed on it, and kept for the VAT inspector. Client-safe. */
export const CREDIT_REASONS = ["Goods returned", "Price corrected", "Discount after sale", "Service not delivered", "Invoiced in error", "Other"] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];
