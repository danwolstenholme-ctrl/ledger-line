-- 30 Oct 2026, once the version with document styles is live: a company's colour and terms are its
-- default document style's now (20261030120000), so the columns the old version read go.
alter table organisations drop column invoice_accent;
alter table organisations drop column invoice_footer;
