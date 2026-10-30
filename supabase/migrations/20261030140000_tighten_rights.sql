-- 30 Oct 2026: the app's role keeps only what schema.sql gives it, the rows of each table under row-level security.
-- Supabase's default rights for tables that postgres makes also gave role authenticated TRUNCATE (which skips row-level
-- security and the audit trail's append-only guard), REFERENCES, TRIGGER and MAINTAIN, on every table and on every table
-- made since. Ledgerline uses none of them: they go, now and for tables made later.
revoke truncate, references, trigger, maintain on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger, maintain on tables from authenticated;

-- The audit trail cannot be emptied by anyone: TRUNCATE skips the row guard, so a statement guard stops it too.
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function audit_guard();

-- No function is for PUBLIC, which anonymous callers are part of. The accounts migration's two trigger functions were left
-- open to it, and only a default set without IN SCHEMA takes PUBLIC's built-in right from functions made later.
revoke execute on function handle_new_auth_user(), handle_auth_email_change() from public;
alter default privileges for role postgres revoke execute on functions from public;
