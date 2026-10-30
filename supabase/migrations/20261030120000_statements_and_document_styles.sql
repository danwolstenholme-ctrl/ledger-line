-- 30 Oct 2026: statements of account with suppliers, checking a supplier's own statement, remittance
-- advice, and document styles. Additive: the version of Ledgerline running before it still works, so this
-- is applied before the new version goes live; 20261030120100 then drops what the old version read.

-- How a company's documents look: its layout, type, colour, what they show, their titles and terms
-- (lib/documents/style, which reads `settings` with a default for everything missing). One is its
-- default; a customer can be given another. Every company starts with one.
create table document_styles (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  is_default      boolean not null default false,
  settings        jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id)
);
create unique index document_styles_one_default on document_styles (organisation_id) where is_default;
create unique index document_styles_name_unique on document_styles (organisation_id, lower(btrim(name)));

create function organisation_document_style() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into document_styles (organisation_id, name, is_default) values (new.id, 'Standard', true);
  return new;
end $$;
create trigger organisations_document_style after insert on organisations for each row execute function organisation_document_style();

-- Every company keeps the look it has: its colour and its terms become its default style.
insert into document_styles (organisation_id, name, is_default, settings)
select id, 'Standard', true,
       jsonb_build_object('accent', lower(invoice_accent))
       || case when nullif(btrim(invoice_footer), '') is null then '{}'::jsonb
               else jsonb_build_object('terms', jsonb_build_object('invoice', invoice_footer, 'quote', invoice_footer, 'credit_note', invoice_footer, 'statement', invoice_footer)) end
  from organisations
 where not exists (select 1 from document_styles s where s.organisation_id = organisations.id and s.is_default);

-- A customer's documents can take another style; the company's default when null.
alter table customers add column document_style_id uuid;
alter table customers add foreign key (organisation_id, document_style_id) references document_styles (organisation_id, id) on delete set null (document_style_id);

-- A supplier's address, for their statement and remittance advice, and the days we have to pay them.
alter table suppliers add column address text;
alter table suppliers add column payment_terms_days smallint check (payment_terms_days between 0 and 365);

-- A statement a supplier sent, checked against the books: their balance on its date, ours, and what explains
-- the difference. `explained` holds each item: one of ours not on their statement yet (a payment still on its
-- way, say), or one of theirs not in the books (a bill not recorded). Agreed when nothing is left unexplained.
-- Their statement itself can be kept with it, as the evidence.
create table supplier_statement_checks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  supplier_id     uuid not null,
  statement_date  date not null,
  their_balance   numeric(14, 2) not null,
  our_balance     numeric(14, 2) not null,
  explained       jsonb not null default '[]' check (jsonb_typeof(explained) = 'array'),
  unexplained     numeric(14, 2) not null default 0,
  agreed          boolean generated always as (unexplained = 0) stored,
  notes           text check (length(notes) <= 2000),
  file_name       text,
  file_type       text check (file_type in ('application/pdf', 'image/png', 'image/jpeg')),
  file_content    bytea,
  checked_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, supplier_id) references suppliers (organisation_id, id) on delete cascade,
  constraint supplier_statement_checks_file check ((file_content is null) = (file_type is null))
);
create index supplier_statement_checks_supplier_idx on supplier_statement_checks (supplier_id, statement_date desc);

create function audit_supplier_statement_check() returns trigger language plpgsql as $$
begin
  perform audit_append(new.organisation_id, 'reconciled', 'supplier_statement', new.id,
    jsonb_build_object('supplier', (select name from suppliers where id = new.supplier_id), 'date', new.statement_date, 'theirs', new.their_balance, 'ours', new.our_balance, 'unexplained', new.unexplained));
  return new;
end $$;
create trigger supplier_statement_checks_audit after insert on supplier_statement_checks for each row execute function audit_supplier_statement_check();

alter table document_styles enable row level security;
alter table supplier_statement_checks enable row level security;
create policy document_styles_read on document_styles for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy document_styles_insert on document_styles for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy document_styles_update on document_styles for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy document_styles_delete on document_styles for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_statement_checks_read on supplier_statement_checks for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy supplier_statement_checks_insert on supplier_statement_checks for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_statement_checks_update on supplier_statement_checks for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_statement_checks_delete on supplier_statement_checks for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));

-- As every other table: the signed-in person's, under the rules above; nothing for anyone else.
grant select, insert, update, delete on document_styles, supplier_statement_checks to authenticated;
revoke all on document_styles, supplier_statement_checks from anon;
revoke execute on function organisation_document_style(), audit_supplier_statement_check() from public, anon;
grant execute on function organisation_document_style(), audit_supplier_statement_check() to authenticated;
