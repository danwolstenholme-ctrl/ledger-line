-- 31 Oct 2026: payments found by their document and their bank account through an index. An invoice's or a bill's balance
-- is summed from its payments on every payment; raising an invoice from a payment, and undoing one, look an invoice's payments
-- up; and each bank page's "in the books, not on a statement yet" reads a bank account's payments and transactions. Without
-- these, each read scans every payment the practice has.
create index if not exists invoice_payments_invoice_idx on invoice_payments (invoice_id);
create index if not exists invoice_payments_bank_idx on invoice_payments (bank_account_id);
create index if not exists bill_payments_bill_idx on bill_payments (bill_id);
create index if not exists bill_payments_bank_idx on bill_payments (bank_account_id);
create index if not exists bank_transactions_bank_idx on bank_transactions (bank_account_id);
create index if not exists bank_transactions_transfer_idx on bank_transactions (transfer_account_id) where transfer_account_id is not null;
