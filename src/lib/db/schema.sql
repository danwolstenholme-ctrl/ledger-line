-- ---------------------------------------------------------------------------
-- Ledgerline: one practice, many client companies, one double-entry ledger
-- each, with every books table carrying organisation_id. Composite foreign keys mean a
-- document can only ever post to accounts of its own organisation.
-- ---------------------------------------------------------------------------

create table practices (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  initials    text not null check (length(btrim(initials)) between 1 and 4),
  brand_color text not null default '#0d6e6e' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  tagline     text,
  -- Below this much fee per hour of work, a client is flagged to reprice.
  fee_floor   numeric(10, 2) not null default 40 check (fee_floor >= 0),
  created_at  timestamptz not null default now()
);

create table organisations (
  id                      uuid primary key default gen_random_uuid(),
  practice_id             uuid not null references practices (id) on delete cascade,
  slug                    text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name                    text not null,
  greek_name              text,
  industry                text not null,
  he_number               text,
  vat_number              text,
  tic                     text,
  vat_registered          boolean not null default true,
  -- Cyprus quarters are staggered: 1 = Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec.
  vat_quarter_end_month   smallint not null default 3 check (vat_quarter_end_month between 1 and 3),
  year_end_month          smallint not null default 12 check (year_end_month between 1 and 12),
  lock_date               date,
  default_bank_account_id uuid,
  ai_suggestions          boolean not null default true,
  contact_name            text,
  contact_email           text,
  address                 text,
  -- How this company numbers its sales documents, and the terms it gives.
  invoice_prefix          text not null default 'INV-',
  payment_terms_days      smallint not null default 30 check (payment_terms_days between 0 and 365),
  -- How its documents look: an accent colour and terms printed at the foot. The logo is kept apart, below.
  invoice_accent          text not null default '#1d2433' check (invoice_accent ~ '^#[0-9a-fA-F]{6}$'),
  invoice_footer          text,
  -- Who at the practice looks after this company: its deadlines and work are theirs.
  manager                 text,
  -- The practice's own books: its clients are its customers, its fees its sales. One per practice.
  is_practice             boolean not null default false,
  -- The first month the practice keeps the books for: deadlines start here until the first entry is posted.
  books_from              date,
  -- What company law needs to know: when it was incorporated (its annual return dates follow), who audits it,
  -- and what keeps it from a review instead of an audit (Cap. 113, s.152A).
  incorporated_on         date,
  auditor_name            text,
  auditor_is_practice     boolean not null default false,
  regulated               boolean not null default false,
  consolidated_group      boolean not null default false,
  -- The country whose tax and company law apply (lib/domain/regimes), and the currency its books are kept in.
  country                 char(2) not null default 'CY' check (country in ('CY', 'GB')),
  -- What kind of business it is (lib/domain/business-types): the starting point for its names, stages and the parts it uses.
  business_type           text not null default 'general' check (business_type in ('trades', 'professional', 'agency', 'retail', 'wholesale', 'marine', 'property', 'health', 'holding', 'general')),
  currency                char(3) not null default 'EUR',
  -- A company, or someone in business on their own: a sole trader is taxed by an individual's tax year.
  entity                  text not null default 'company' check (entity in ('company', 'sole_trader')),
  -- How VAT is returned: every quarter (the stagger above), every month, or once a year (UK annual accounting,
  -- the year ending in vat_year_end_month, with payments on account monthly or quarterly).
  vat_period              text not null default 'quarterly' check (vat_period in ('quarterly', 'monthly', 'annual')),
  vat_year_end_month      smallint check (vat_year_end_month between 1 and 12),
  vat_annual_payments     text check (vat_annual_payments in ('monthly', 'quarterly')),
  -- UK schemes. Cash accounting: VAT follows payments. The flat rate: its percentage of VAT-inclusive turnover;
  -- with cash accounting set too, the scheme's own cash-based turnover (the two schemes cannot be combined).
  vat_cash_accounting     boolean not null default false,
  vat_flat_rate           numeric(4, 2) check (vat_flat_rate > 0 and vat_flat_rate <= 16.5),
  created_at              timestamptz not null default now(),
  constraint organisations_currency check ((country = 'CY' and currency = 'EUR') or (country = 'GB' and currency = 'GBP')),
  constraint organisations_uk_schemes check (country = 'GB' or (vat_period <> 'annual' and not vat_cash_accounting and vat_flat_rate is null)),
  constraint organisations_annual check ((vat_period = 'annual') = (vat_year_end_month is not null and vat_annual_payments is not null))
);
create unique index organisations_one_practice on organisations (practice_id) where is_practice;

-- A company's logo, for its invoices, quotes and statements. Apart from the company row, which every page reads.
create table organisation_logos (
  organisation_id uuid primary key references organisations (id) on delete cascade,
  media_type      text not null check (media_type in ('image/png', 'image/jpeg')),
  content         bytea not null,
  updated_at      timestamptz not null default now()
);

-- The people who use Ledgerline. auth_id is their sign-in: live, a Supabase Auth
-- user's id (supabase/migrations links the two by email when the account is
-- made); in the laptop demo, a stand-in. Null until they first sign in, so a
-- person can be invited, or seeded, before their account exists.
create table app_users (
  id         uuid primary key default gen_random_uuid(),
  auth_id    uuid unique,
  name       text not null check (length(btrim(name)) between 1 and 200),
  email      text not null unique check (email = lower(email)),
  initials   text not null,
  created_at timestamptz not null default now()
);

-- Who is asking: the person whose sign-in is named by the claims Supabase sets on every request
-- (the demo sets the same claims). Null when nobody is signed in.
create function app_user_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from app_users where auth_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------

create type ledger_account_type as enum (
  'bank', 'current_asset', 'fixed_asset', 'current_liability', 'non_current_liability',
  'equity', 'revenue', 'other_income', 'direct_costs', 'expense', 'depreciation'
);

create table ledger_accounts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  code            text not null check (code ~ '^[0-9]{3,6}$'),
  name            text not null check (length(btrim(name)) between 1 and 120),
  type            ledger_account_type not null,
  system_role     text check (system_role in ('receivable', 'payable', 'vat', 'sales', 'retained_earnings')),
  description     text,
  -- Never on a VAT return, whatever passes through it: wages, PAYE and NIC, business rates, dividends.
  outside_vat     boolean not null default false,
  bank_details    text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, code),
  unique (organisation_id, system_role),
  unique (organisation_id, id)
);

alter table organisations add constraint organisations_default_bank
  foreign key (id, default_bank_account_id) references ledger_accounts (organisation_id, id) deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Customers and suppliers, per organisation
-- ---------------------------------------------------------------------------

create table customers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  name            text not null,
  email           text,
  phone           text,
  vat_number      text,
  country         char(2) not null default 'CY',
  address         text,
  -- A business in another EU state: invoices start as reverse charge and go on the VIES statement.
  eu_business     boolean not null default false,
  default_account_id uuid,
  -- Days this customer has to pay; the company's own terms when not set.
  payment_terms_days smallint check (payment_terms_days between 0 and 365),
  -- The company's own details on its customers (custom_fields), by key.
  extra           jsonb not null default '{}' check (jsonb_typeof(extra) = 'object'),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, default_account_id) references ledger_accounts (organisation_id, id)
);

create table suppliers (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisations (id) on delete cascade,
  name               text not null check (length(btrim(name)) between 1 and 200),
  greek_name         text,
  email              text,
  phone              text,
  vat_number         text,
  country            char(2) not null default 'CY',
  default_account_id uuid,
  notes              text,
  is_active          boolean not null default true,
  reverse_charge     boolean not null default false,
  -- Where the supplier is paid: needed for a SEPA payment file.
  iban               text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  bic                text check (bic is null or bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, default_account_id) references ledger_accounts (organisation_id, id)
);
create unique index suppliers_name_unique on suppliers (organisation_id, lower(btrim(name))) where is_active;

-- ---------------------------------------------------------------------------
-- Products and services: what a company sells, priced once
-- ---------------------------------------------------------------------------

create table items (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  code            text,
  name            text not null,
  description     text,
  unit            text,
  unit_price      numeric(14, 4) not null default 0 check (unit_price >= 0),
  vat_rate        numeric(5, 2) not null default 19 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  account_id      uuid not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);
create unique index items_code_unique on items (organisation_id, lower(btrim(code))) where code is not null and is_active;
create unique index items_name_unique on items (organisation_id, lower(btrim(name))) where is_active;

-- ---------------------------------------------------------------------------
-- Sales invoices: the same line model as bills
-- ---------------------------------------------------------------------------

create type invoice_status as enum ('draft', 'issued', 'part_paid', 'paid', 'void');
create type vat_treatment as enum ('standard', 'exempt', 'reverse_charge', 'outside_scope');

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  customer_id     uuid not null,
  number          text not null,
  issued_on       date not null,
  due_on          date,
  -- The company's own currency unless set (document_currency, below).
  currency        char(3) not null,
  vat_treatment   vat_treatment not null default 'standard',
  net             numeric(14, 2) not null default 0,
  vat_amount      numeric(14, 2) not null default 0,
  total           numeric(14, 2) generated always as (net + vat_amount) stored,
  amount_paid     numeric(14, 2) not null default 0,
  -- Taken off by credit notes allocated to it. The balance is the total less both.
  amount_credited numeric(14, 2) not null default 0 check (amount_credited >= 0),
  -- The customer's own reference for it, such as their purchase order number.
  reference       text,
  -- When it was last sent to the customer, and to whom.
  sent_at         timestamptz,
  sent_to         text,
  status          invoice_status not null default 'issued',
  notes           text,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, number),
  foreign key (organisation_id, customer_id) references customers (organisation_id, id),
  constraint invoices_not_overpaid check (amount_paid + amount_credited <= net + vat_amount),
  constraint invoices_vat_treatment check (vat_treatment = 'standard' or vat_amount = 0)
);

create table invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  invoice_id      uuid not null,
  position        smallint not null,
  description     text not null,
  account_id      uuid not null,
  item_id         uuid references items (id) on delete set null,
  unit            text,
  quantity        numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price      numeric(14, 4) check (unit_price >= 0),
  discount_pct    numeric(5, 2) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  net             numeric(14, 2) not null check (net >= 0),
  vat_rate        numeric(5, 2) not null default 19 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  vat_amount      numeric(14, 2) not null default 0,
  unique (invoice_id, position),
  foreign key (organisation_id, invoice_id) references invoices (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);

create table invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  invoice_id      uuid not null,
  received_on     date not null,
  amount          numeric(14, 2) not null check (amount > 0),
  bank_account_id uuid not null,
  method          text not null default 'bank_transfer',
  reference       text,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, invoice_id) references invoices (organisation_id, id) on delete cascade,
  foreign key (organisation_id, bank_account_id) references ledger_accounts (organisation_id, id)
);

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------

create type bill_status as enum ('awaiting_payment', 'part_paid', 'paid', 'void');

create table bills (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisations (id) on delete cascade,
  supplier_id        uuid not null,
  number             text,
  reference          text,
  issued_on          date not null,
  due_on             date,
  -- The company's own currency unless set (document_currency, below).
  currency           char(3) not null,
  net                numeric(14, 2) not null default 0 check (net >= 0),
  vat_amount         numeric(14, 2) not null default 0 check (vat_amount >= 0),
  total              numeric(14, 2) generated always as (net + vat_amount) stored,
  amount_paid        numeric(14, 2) not null default 0 check (amount_paid >= 0),
  -- Taken off by the supplier's credit notes set against it.
  amount_credited    numeric(14, 2) not null default 0 check (amount_credited >= 0),
  status             bill_status not null default 'awaiting_payment',
  notes              text,
  source_document    text,
  capture_item_id    uuid,
  reverse_charge     boolean not null default false,
  reverse_charge_vat numeric(14, 2) not null default 0,
  -- Which reverse charge: services from abroad, construction (CIS), or imports under postponed VAT accounting.
  reverse_charge_kind text check (reverse_charge_kind in ('services', 'construction', 'import')),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, supplier_id) references suppliers (organisation_id, id),
  constraint bills_due_after_issue check (due_on is null or due_on >= issued_on),
  constraint bills_not_overpaid check (amount_paid + amount_credited <= net + vat_amount),
  constraint bills_reverse_charge check (case when reverse_charge then vat_amount = 0 else reverse_charge_vat = 0 end)
);
create unique index bills_supplier_number_unique on bills (organisation_id, supplier_id, lower(btrim(number)))
  where number is not null and status <> 'void';

create table bill_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  bill_id         uuid not null,
  position        smallint not null,
  description     text not null,
  account_id      uuid not null,
  net             numeric(14, 2) not null check (net >= 0),
  vat_rate        numeric(5, 2) not null default 19 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  vat_amount      numeric(14, 2) not null default 0 check (vat_amount >= 0),
  unique (bill_id, position),
  foreign key (organisation_id, bill_id) references bills (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);

-- Several bills paid together: one bank account, one day, one SEPA file for the bank.
create table bill_payment_runs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  bank_account_id uuid not null,
  paid_on         date not null,
  reference       text,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, bank_account_id) references ledger_accounts (organisation_id, id)
);

create table bill_payments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  bill_id         uuid not null,
  run_id          uuid references bill_payment_runs (id) on delete set null,
  paid_on         date not null,
  amount          numeric(14, 2) not null check (amount > 0),
  bank_account_id uuid not null,
  method          text not null default 'bank_transfer',
  reference       text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, bill_id) references bills (organisation_id, id) on delete cascade,
  foreign key (organisation_id, bank_account_id) references ledger_accounts (organisation_id, id)
);

-- ---------------------------------------------------------------------------
-- Bank transactions: money spent, received, moved
-- ---------------------------------------------------------------------------

create type bank_transaction_kind as enum ('spend', 'receive', 'transfer');

create table bank_transactions (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations (id) on delete cascade,
  kind                bank_transaction_kind not null,
  bank_account_id     uuid not null,
  transfer_account_id uuid,
  txn_date            date not null,
  contact             text,
  reference           text,
  amount              numeric(14, 2) not null default 0 check (amount >= 0),
  net                 numeric(14, 2) not null default 0 check (net >= 0),
  vat_amount          numeric(14, 2) not null default 0 check (vat_amount >= 0),
  reverse_charge      boolean not null default false,
  reverse_charge_vat  numeric(14, 2) not null default 0,
  reverse_charge_kind text check (reverse_charge_kind in ('services', 'construction', 'import')),
  -- Set on a refund of a customer's credit: it posts against receivables, and has no lines.
  credit_note_id      uuid,
  -- Set on a refund received from a supplier against their credit note: it posts against payables.
  supplier_credit_id  uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, bank_account_id) references ledger_accounts (organisation_id, id),
  foreign key (organisation_id, transfer_account_id) references ledger_accounts (organisation_id, id),
  constraint bank_transactions_transfer check ((kind = 'transfer') = (transfer_account_id is not null))
);

create table bank_transaction_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  transaction_id  uuid not null,
  position        smallint not null,
  description     text not null,
  account_id      uuid not null,
  net             numeric(14, 2) not null check (net >= 0),
  vat_rate        numeric(5, 2) not null default 0 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  vat_amount      numeric(14, 2) not null default 0 check (vat_amount >= 0),
  unique (transaction_id, position),
  foreign key (organisation_id, transaction_id) references bank_transactions (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);

-- ---------------------------------------------------------------------------
-- The general ledger
-- ---------------------------------------------------------------------------

create type journal_source as enum ('invoice', 'invoice_payment', 'bill', 'bill_payment', 'bank', 'manual', 'credit_note', 'supplier_credit', 'payroll');

create table journal_entries (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  entry_date      date not null,
  source          journal_source not null,
  source_id       uuid,
  reference       text,
  narration       text not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  constraint journal_entries_source check ((source = 'manual') = (source_id is null))
);
create unique index journal_entries_source_unique on journal_entries (source, source_id) where source_id is not null;
create index journal_entries_org_date on journal_entries (organisation_id, entry_date);
create index journal_entries_org_created on journal_entries (organisation_id, created_at);

create table journal_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entry_id        uuid not null,
  account_id      uuid not null,
  debit           numeric(14, 2) not null default 0 check (debit >= 0),
  credit          numeric(14, 2) not null default 0 check (credit >= 0),
  is_tax          boolean not null default false,
  description     text,
  foreign key (organisation_id, entry_id) references journal_entries (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id),
  constraint journal_lines_one_side check ((debit > 0) <> (credit > 0))
);
create index journal_lines_entry_idx on journal_lines (entry_id);
create index journal_lines_account_idx on journal_lines (account_id);

create function check_journal_balance() returns trigger language plpgsql as $$
declare v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  if exists (select 1 from journal_entries where id = v_entry)
     and (select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) from journal_lines where entry_id = v_entry) <> 0 then
    raise exception 'journal_unbalanced: debits and credits must be equal' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger journal_lines_balance after insert or update or delete on journal_lines
  deferrable initially deferred for each row execute function check_journal_balance();

create function org_lock_date(p_org uuid) returns date language sql stable as $$
  select lock_date from organisations where id = p_org;
$$;

-- Replace a document's entry with the lines given; nothing when they are empty.
-- An unchanged entry is left alone; a change that touches a locked date is refused.
create function ledger_replace(p_org uuid, p_source journal_source, p_source_id uuid, p_date date,
                               p_reference text, p_narration text, p_lines jsonb) returns void
language plpgsql as $$
declare
  v_lock  date := org_lock_date(p_org);
  v_old   journal_entries;
  v_entry uuid;
  v_new   jsonb;
  v_had   jsonb;
begin
  select * into v_old from journal_entries where source = p_source and source_id = p_source_id;
  select coalesce(jsonb_agg(jsonb_build_object('a', (l->>'account_id')::uuid, 'd', round(coalesce((l->>'debit')::numeric, 0), 2),
                                               'c', round(coalesce((l->>'credit')::numeric, 0), 2), 't', coalesce((l->>'is_tax')::boolean, false))
                            order by (l->>'account_id'), round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2), coalesce((l->>'is_tax')::boolean, false)), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
   where round(coalesce((l->>'debit')::numeric, 0), 2) > 0 or round(coalesce((l->>'credit')::numeric, 0), 2) > 0;

  if v_old.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('a', account_id, 'd', debit, 'c', credit, 't', is_tax)
                              order by account_id::text, debit, credit, is_tax), '[]'::jsonb)
      into v_had from journal_lines where entry_id = v_old.id;
    if v_had = v_new and v_old.entry_date = p_date then
      update journal_entries set reference = p_reference, narration = p_narration
       where id = v_old.id and (reference, narration) is distinct from (p_reference, p_narration);
      return;
    end if;
    if v_lock is not null and v_old.entry_date <= v_lock then
      raise exception 'period_locked: the books are locked up to %', v_lock using errcode = '23514';
    end if;
    delete from journal_entries where id = v_old.id;
  end if;

  if jsonb_array_length(v_new) = 0 then return; end if;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'period_locked: the books are locked up to %', v_lock using errcode = '23514';
  end if;
  insert into journal_entries (organisation_id, entry_date, source, source_id, reference, narration)
  values (p_org, p_date, p_source, p_source_id, p_reference, left(p_narration, 300))
  returning id into v_entry;
  insert into journal_lines (organisation_id, entry_id, account_id, debit, credit, is_tax, description)
  select p_org, v_entry, (l->>'account_id')::uuid, round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         coalesce((l->>'is_tax')::boolean, false), left(l->>'description', 300)
    from jsonb_array_elements(p_lines) l
   where round(coalesce((l->>'debit')::numeric, 0), 2) > 0 or round(coalesce((l->>'credit')::numeric, 0), 2) > 0;
end $$;

create function ledger_system_account(p_org uuid, p_role text) returns uuid language sql stable as $$
  select id from ledger_accounts where organisation_id = p_org and system_role = p_role;
$$;

-- ---------------------------------------------------------------------------
-- Posting: each document to its one entry
-- ---------------------------------------------------------------------------

-- A sales invoice: the customer owes the total; each line's account earns its net, VAT is owed.
create function post_invoice(p_id uuid) returns void language plpgsql as $$
declare
  v invoices;
  v_org uuid;
  v_customer text;
  v_lines jsonb;
begin
  select * into v from invoices where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'invoice' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'invoice', p_id, null, null, null, null); end if;
    return;
  end if;
  if v.status not in ('issued', 'part_paid', 'paid') or v.currency <> (select currency from organisations where id = v.organisation_id) then
    perform ledger_replace(v.organisation_id, 'invoice', p_id, null, null, null, null);
    return;
  end if;
  select name into v_customer from customers where id = v.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'credit', net, 'description', description)), '[]'::jsonb)
    into v_lines
    from (select account_id, sum(net) as net, min(description) as description from invoice_lines where invoice_id = p_id group by account_id) grouped;
  perform ledger_replace(v.organisation_id, 'invoice', p_id, v.issued_on, v.number,
    'Invoice ' || v.number || coalesce(' · ' || v_customer, ''),
    v_lines || jsonb_build_array(
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'receivable'), 'debit', v.total),
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'vat'), 'credit', v.vat_amount, 'is_tax', true)
    ));
end $$;

create function post_invoice_payment(p_id uuid) returns void language plpgsql as $$
declare
  v invoice_payments;
  v_invoice invoices;
  v_org uuid;
begin
  select * into v from invoice_payments where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'invoice_payment' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'invoice_payment', p_id, null, null, null, null); end if;
    return;
  end if;
  select * into v_invoice from invoices where id = v.invoice_id;
  perform ledger_replace(v.organisation_id, 'invoice_payment', p_id, v.received_on, coalesce(v.reference, v_invoice.number),
    'Payment received · invoice ' || v_invoice.number,
    jsonb_build_array(
      jsonb_build_object('account_id', v.bank_account_id, 'debit', v.amount),
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'receivable'), 'credit', v.amount)
    ));
end $$;

-- A bill: each line's account carries its net, VAT is reclaimable, the supplier is owed the total.
-- A company that is not registered for VAT cannot reclaim it: the VAT is part of the cost.
create function post_bill(p_id uuid) returns void language plpgsql as $$
declare
  v bills;
  v_org uuid;
  v_supplier text;
  v_lines jsonb;
  v_registered boolean;
  v_vat uuid;
begin
  select * into v from bills where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'bill' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'bill', p_id, null, null, null, null); end if;
    return;
  end if;
  if v.status = 'void' then
    perform ledger_replace(v.organisation_id, 'bill', p_id, null, null, null, null);
    return;
  end if;
  v_vat := ledger_system_account(v.organisation_id, 'vat');
  select vat_registered into v_registered from organisations where id = v.organisation_id;
  select name into v_supplier from suppliers where id = v.supplier_id;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', amount, 'description', description)), '[]'::jsonb)
    into v_lines
    from (select account_id, sum(net + case when v_registered or v.reverse_charge then 0 else vat_amount end) as amount, min(description) as description
            from bill_lines where bill_id = p_id group by account_id) grouped;
  perform ledger_replace(v.organisation_id, 'bill', p_id, v.issued_on, coalesce(v.number, v.reference),
    'Bill · ' || v_supplier || coalesce(' ' || v.number, ''),
    v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_vat, 'debit', case when v_registered then v.vat_amount else 0 end, 'is_tax', true),
      jsonb_build_object('account_id', v_vat, 'debit', v.reverse_charge_vat, 'is_tax', true, 'description', 'Reverse charge: VAT reclaimed'),
      jsonb_build_object('account_id', v_vat, 'credit', v.reverse_charge_vat, 'is_tax', true, 'description', 'Reverse charge: VAT due'),
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'payable'), 'credit', v.total)
    ));
end $$;

create function post_bill_payment(p_id uuid) returns void language plpgsql as $$
declare
  v bill_payments;
  v_bill bills;
  v_supplier text;
  v_org uuid;
begin
  select * into v from bill_payments where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'bill_payment' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'bill_payment', p_id, null, null, null, null); end if;
    return;
  end if;
  select * into v_bill from bills where id = v.bill_id;
  select name into v_supplier from suppliers where id = v_bill.supplier_id;
  perform ledger_replace(v.organisation_id, 'bill_payment', p_id, v.paid_on, coalesce(v.reference, v_bill.number),
    'Payment made · ' || v_supplier || coalesce(' ' || v_bill.number, ''),
    jsonb_build_array(
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'payable'), 'debit', v.amount),
      jsonb_build_object('account_id', v.bank_account_id, 'credit', v.amount)
    ));
end $$;

create function post_bank_transaction(p_id uuid) returns void language plpgsql as $$
declare
  v bank_transactions;
  v_lines jsonb;
  v_side text;
  v_vat uuid;
  v_org uuid;
  v_registered boolean;
begin
  select * into v from bank_transactions where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'bank' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'bank', p_id, null, null, null, null); end if;
    return;
  end if;
  if v.kind = 'transfer' then
    perform ledger_replace(v.organisation_id, 'bank', p_id, v.txn_date, v.reference, 'Transfer between bank accounts',
      jsonb_build_array(
        jsonb_build_object('account_id', v.transfer_account_id, 'debit', v.amount),
        jsonb_build_object('account_id', v.bank_account_id, 'credit', v.amount)
      ));
    return;
  end if;
  v_vat := ledger_system_account(v.organisation_id, 'vat');
  select vat_registered into v_registered from organisations where id = v.organisation_id;
  -- A refund of a credit note: the customer's balance goes back up as the money leaves the bank.
  if v.credit_note_id is not null then
    perform ledger_replace(v.organisation_id, 'bank', p_id, v.txn_date, v.reference, 'Refund' || coalesce(' · ' || v.contact, ''),
      jsonb_build_array(
        jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'receivable'), 'debit', v.amount),
        jsonb_build_object('account_id', v.bank_account_id, 'credit', v.amount)
      ));
    return;
  end if;
  -- A refund received from a supplier: the money comes in, and what they owed back is settled.
  if v.supplier_credit_id is not null then
    perform ledger_replace(v.organisation_id, 'bank', p_id, v.txn_date, v.reference, 'Refund received' || coalesce(' · ' || v.contact, ''),
      jsonb_build_array(
        jsonb_build_object('account_id', v.bank_account_id, 'debit', v.amount),
        jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'payable'), 'credit', v.amount)
      ));
    return;
  end if;
  v_side := case when v.kind = 'spend' then 'debit' else 'credit' end;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, v_side, amount, 'description', description)), '[]'::jsonb)
    into v_lines
    from (select account_id, sum(net + case when v_registered or v.reverse_charge then 0 else vat_amount end) as amount, min(description) as description
            from bank_transaction_lines where transaction_id = p_id group by account_id) grouped;
  perform ledger_replace(v.organisation_id, 'bank', p_id, v.txn_date, v.reference,
    case when v.kind = 'spend' then 'Money spent' else 'Money received' end || coalesce(' · ' || v.contact, ''),
    v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_vat, v_side, case when v_registered then v.vat_amount else 0 end, 'is_tax', true),
      jsonb_build_object('account_id', v_vat, 'debit', v.reverse_charge_vat, 'is_tax', true, 'description', 'Reverse charge: VAT reclaimed'),
      jsonb_build_object('account_id', v_vat, 'credit', v.reverse_charge_vat, 'is_tax', true, 'description', 'Reverse charge: VAT due'),
      jsonb_build_object('account_id', v.bank_account_id, case when v.kind = 'spend' then 'credit' else 'debit' end, v.net + v.vat_amount)
    ));
end $$;

create function post_invoice_trigger() returns trigger language plpgsql as $$
begin perform post_invoice(coalesce(new.id, old.id)); return null; end $$;
create function post_invoice_lines_trigger() returns trigger language plpgsql as $$
begin perform post_invoice(coalesce(new.invoice_id, old.invoice_id)); return null; end $$;
create constraint trigger invoice_ledger after insert or update or delete on invoices
  deferrable initially deferred for each row execute function post_invoice_trigger();
create constraint trigger invoice_lines_ledger after insert or update or delete on invoice_lines
  deferrable initially deferred for each row execute function post_invoice_lines_trigger();

create function post_invoice_payment_trigger() returns trigger language plpgsql as $$
begin perform post_invoice_payment(coalesce(new.id, old.id)); return null; end $$;
create trigger invoice_payment_ledger after insert or update or delete on invoice_payments
  for each row execute function post_invoice_payment_trigger();

create function post_bill_trigger() returns trigger language plpgsql as $$
begin perform post_bill(coalesce(new.id, old.id)); return null; end $$;
create function post_bill_lines_trigger() returns trigger language plpgsql as $$
begin perform post_bill(coalesce(new.bill_id, old.bill_id)); return null; end $$;
create constraint trigger bill_ledger after insert or update or delete on bills
  deferrable initially deferred for each row execute function post_bill_trigger();
create constraint trigger bill_lines_ledger after insert or update or delete on bill_lines
  deferrable initially deferred for each row execute function post_bill_lines_trigger();

create function post_bill_payment_trigger() returns trigger language plpgsql as $$
begin perform post_bill_payment(coalesce(new.id, old.id)); return null; end $$;
create trigger bill_payment_ledger after insert or update or delete on bill_payments
  for each row execute function post_bill_payment_trigger();

create function post_bank_transaction_trigger() returns trigger language plpgsql as $$
begin perform post_bank_transaction(coalesce(new.id, old.id)); return null; end $$;
create function post_bank_transaction_lines_trigger() returns trigger language plpgsql as $$
begin perform post_bank_transaction(coalesce(new.transaction_id, old.transaction_id)); return null; end $$;
create constraint trigger bank_transaction_ledger after insert or update or delete on bank_transactions
  deferrable initially deferred for each row execute function post_bank_transaction_trigger();
create constraint trigger bank_transaction_lines_ledger after insert or update or delete on bank_transaction_lines
  deferrable initially deferred for each row execute function post_bank_transaction_lines_trigger();

-- Payments keep the document's paid amount and status in step.
create function sync_bill_balance(p_bill uuid) returns void language plpgsql as $$
declare v_paid numeric(14, 2); v_credited numeric(14, 2);
begin
  select coalesce(sum(amount), 0) into v_paid from bill_payments where bill_id = p_bill;
  select coalesce(sum(amount), 0) into v_credited from supplier_credit_allocations where bill_id = p_bill;
  update bills set amount_paid = v_paid, amount_credited = v_credited,
         status = case when v_paid + v_credited = 0 then 'awaiting_payment'::bill_status when v_paid + v_credited < total then 'part_paid'::bill_status else 'paid'::bill_status end
   where id = p_bill and status <> 'void';
end $$;
create function sync_bill_payment() returns trigger language plpgsql as $$
begin perform sync_bill_balance(coalesce(new.bill_id, old.bill_id)); return null; end $$;
create trigger bill_payment_sync after insert or delete on bill_payments for each row execute function sync_bill_payment();

create function guard_bill_payment() returns trigger language plpgsql as $$
declare v_bill record;
begin
  select status, total, amount_paid, amount_credited into v_bill from bills where id = new.bill_id for update;
  if v_bill.status = 'void' then raise exception 'bill_payment_closed: a void bill cannot be paid' using errcode = '23514'; end if;
  if new.amount > v_bill.total - v_bill.amount_paid - v_bill.amount_credited then
    raise exception 'bills_not_overpaid: that is more than the balance on this bill' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger bill_payment_guard before insert on bill_payments for each row execute function guard_bill_payment();

-- What has been paid and what credit notes have taken off, together decide whether an invoice is still owed.
create function sync_invoice_balance(p_invoice uuid) returns void language plpgsql as $$
declare v_paid numeric(14, 2); v_credited numeric(14, 2);
begin
  select coalesce(sum(amount), 0) into v_paid from invoice_payments where invoice_id = p_invoice;
  select coalesce(sum(amount), 0) into v_credited from credit_allocations where invoice_id = p_invoice;
  update invoices set amount_paid = v_paid, amount_credited = v_credited,
         status = case when v_paid + v_credited = 0 then 'issued'::invoice_status when v_paid + v_credited < total then 'part_paid'::invoice_status else 'paid'::invoice_status end
   where id = p_invoice and status in ('issued', 'part_paid', 'paid');
end $$;
create function sync_invoice_payment() returns trigger language plpgsql as $$
begin perform sync_invoice_balance(coalesce(new.invoice_id, old.invoice_id)); return null; end $$;
create trigger invoice_payment_sync after insert or delete on invoice_payments for each row execute function sync_invoice_payment();

create function guard_invoice_payment() returns trigger language plpgsql as $$
declare v_invoice record;
begin
  select status, total, amount_paid, amount_credited into v_invoice from invoices where id = new.invoice_id for update;
  if v_invoice.status not in ('issued', 'part_paid') then
    raise exception 'invoice_payment_closed: only an issued invoice can take a payment' using errcode = '23514';
  end if;
  if new.amount > v_invoice.total - v_invoice.amount_paid - v_invoice.amount_credited then
    raise exception 'invoices_not_overpaid: that is more than the balance on this invoice' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger invoice_payment_guard before insert on invoice_payments for each row execute function guard_invoice_payment();

-- ---------------------------------------------------------------------------
-- Writing documents
-- ---------------------------------------------------------------------------

-- The VAT rates each country uses: Cyprus 19, 9, 5, 3 and 0; the UK 20, 5 and 0.
create function vat_rates(p_country text) returns numeric[] language sql immutable as $$
  select case p_country when 'GB' then array[20, 5, 0]::numeric[] else array[19, 9, 5, 3, 0]::numeric[] end;
$$;

create function ledger_document_lines(p_org uuid, p_lines jsonb, p_label text)
returns table (pos integer, description text, account_id uuid, net numeric, vat_rate numeric, vat_amount numeric,
               item_id uuid, unit text, quantity numeric, unit_price numeric, discount_pct numeric)
language plpgsql as $$
declare
  v_line jsonb; v_pos integer := 0; v_type ledger_account_type; v_role text; v_net numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'ledger_lines_required: a % needs between 1 and 200 lines', p_label using errcode = '23514';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    pos := v_pos;
    description := btrim(coalesce(v_line->>'description', ''));
    account_id := nullif(v_line->>'account_id', '')::uuid;
    item_id := nullif(v_line->>'item_id', '')::uuid;
    unit := nullif(btrim(coalesce(v_line->>'unit', '')), '');
    unit_price := nullif(v_line->>'unit_price', '')::numeric;
    if unit_price is null then
      -- A single amount: one of it, at its net.
      net := round(coalesce((v_line->>'net')::numeric, 0), 2);
      quantity := 1; discount_pct := 0;
    else
      quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 1);
      discount_pct := coalesce(nullif(v_line->>'discount_pct', '')::numeric, 0);
      if quantity <= 0 or unit_price < 0 or discount_pct < 0 or discount_pct >= 100 then
        raise exception 'ledger_line_quantity: line % needs a quantity above zero, a price and a discount under 100%%', v_pos using errcode = '23514';
      end if;
      net := round(quantity * unit_price * (100 - discount_pct) / 100, 2);
      v_net := nullif(v_line->>'net', '')::numeric;
      if v_net is not null and abs(round(v_net, 2) - net) > 0.01 then
        raise exception 'ledger_line_net: the amount on line % is not its quantity times its price, less the discount', v_pos using errcode = '23514';
      end if;
    end if;
    vat_rate := coalesce((v_line->>'vat_rate')::numeric, 0);
    vat_amount := round(coalesce(nullif(v_line->>'vat_amount', '')::numeric, net * vat_rate / 100), 2);
    select a.type, a.system_role into v_type, v_role from ledger_accounts a where a.id = account_id and a.organisation_id = p_org and a.is_active;
    if description = '' or account_id is null or v_type is null or net < 0 then
      raise exception 'ledger_lines_required: line % needs a description, an account and an amount', v_pos using errcode = '23514';
    end if;
    if item_id is not null and not exists (select 1 from items i where i.id = item_id and i.organisation_id = p_org) then
      raise exception 'ledger_line_item: line % names a product this company does not sell', v_pos using errcode = '23514';
    end if;
    -- A VAT payment to or refund from the Tax Department is money spent or received on the VAT account itself.
    if v_type = 'bank' or v_role in ('receivable', 'payable') or (v_role = 'vat' and p_label in ('bill', 'invoice', 'quote', 'credit note', 'supplier credit')) then
      raise exception 'ledger_line_account: line % cannot be coded to a bank, receivable, payable or VAT account', v_pos using errcode = '23514';
    end if;
    if not (vat_rate = any (vat_rates((select country from organisations where id = p_org)))) then
      raise exception 'ledger_vat_rate: line % has a VAT rate of %%%, which % does not use', v_pos, vat_rate, (select country from organisations where id = p_org) using errcode = '23514';
    end if;
    if abs(vat_amount - round(net * vat_rate / 100, 2)) > 0.01 then
      raise exception 'ledger_vat_amount: the VAT on line % does not match its rate', v_pos using errcode = '23514';
    end if;
    return next;
  end loop;
end $$;

create function save_bill(p_org uuid, p_id uuid, p_supplier_id uuid, p_number text, p_reference text,
  p_issued_on date, p_due_on date, p_notes text, p_source_document text, p_lines jsonb, p_reverse_charge boolean default false, p_reverse_charge_kind text default null)
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_net numeric(14, 2); v_vat numeric(14, 2); v_rc boolean := coalesce(p_reverse_charge, false);
begin
  select coalesce(sum(l.net), 0), coalesce(sum(l.vat_amount), 0) into v_net, v_vat from ledger_document_lines(p_org, p_lines, 'bill') l;
  if v_id is null then
    insert into bills (organisation_id, supplier_id, number, reference, issued_on, due_on, net, vat_amount, reverse_charge, reverse_charge_vat, reverse_charge_kind, notes, source_document)
    values (p_org, p_supplier_id, nullif(btrim(p_number), ''), nullif(btrim(p_reference), ''), p_issued_on, p_due_on, v_net,
            case when v_rc then 0 else v_vat end, v_rc, case when v_rc then v_vat else 0 end, p_reverse_charge_kind, nullif(btrim(p_notes), ''), nullif(btrim(p_source_document), ''))
    returning id into v_id;
  else
    update bills set supplier_id = p_supplier_id, number = nullif(btrim(p_number), ''), reference = nullif(btrim(p_reference), ''),
           issued_on = p_issued_on, due_on = p_due_on, net = v_net, vat_amount = case when v_rc then 0 else v_vat end,
           reverse_charge = v_rc, reverse_charge_vat = case when v_rc then v_vat else 0 end, reverse_charge_kind = p_reverse_charge_kind,
           notes = nullif(btrim(p_notes), ''), source_document = nullif(btrim(p_source_document), ''), updated_at = now()
     where id = v_id and organisation_id = p_org and status <> 'void';
    if not found then raise exception 'bill_closed: this bill is void or no longer exists' using errcode = '23514'; end if;
    delete from bill_lines where bill_id = v_id;
  end if;
  insert into bill_lines (organisation_id, bill_id, position, description, account_id, net, vat_rate, vat_amount)
  select p_org, v_id, l.pos, l.description, l.account_id, l.net, l.vat_rate, l.vat_amount from ledger_document_lines(p_org, p_lines, 'bill') l order by l.pos;
  return v_id;
end $$;

create function set_bill_void(p_id uuid, p_void boolean) returns void language plpgsql as $$
begin
  update bills set status = case when p_void then 'void'::bill_status else 'awaiting_payment'::bill_status end
   where id = p_id and status = case when p_void then 'awaiting_payment'::bill_status else 'void'::bill_status end;
  if not found then raise exception 'bill_has_payments: only an unpaid bill can be voided' using errcode = '23514'; end if;
end $$;

create function save_invoice(p_org uuid, p_id uuid, p_customer_id uuid, p_number text, p_issued_on date, p_due_on date,
  p_treatment vat_treatment, p_notes text, p_lines jsonb, p_status invoice_status default 'issued', p_reference text default null)
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_net numeric(14, 2); v_vat numeric(14, 2);
begin
  select coalesce(sum(l.net), 0), coalesce(sum(l.vat_amount), 0) into v_net, v_vat from ledger_document_lines(p_org, p_lines, 'invoice') l;
  if p_treatment <> 'standard' then v_vat := 0; end if;
  if v_id is null then
    insert into invoices (organisation_id, customer_id, number, issued_on, due_on, vat_treatment, net, vat_amount, notes, status, reference)
    values (p_org, p_customer_id, btrim(p_number), p_issued_on, p_due_on, p_treatment, v_net, v_vat, nullif(btrim(p_notes), ''), p_status, nullif(btrim(p_reference), ''))
    returning id into v_id;
  else
    update invoices set customer_id = p_customer_id, number = btrim(p_number), issued_on = p_issued_on, due_on = p_due_on,
           vat_treatment = p_treatment, net = v_net, vat_amount = v_vat, notes = nullif(btrim(p_notes), ''), reference = nullif(btrim(p_reference), '')
     where id = v_id and organisation_id = p_org and amount_paid = 0 and amount_credited = 0 and status in ('draft', 'issued');
    if not found then raise exception 'invoice_has_payments: only an open invoice with no payments can be edited' using errcode = '23514'; end if;
    delete from invoice_lines where invoice_id = v_id;
  end if;
  insert into invoice_lines (organisation_id, invoice_id, position, description, account_id, net, vat_rate, vat_amount, item_id, unit, quantity, unit_price, discount_pct)
  select p_org, v_id, l.pos, l.description, l.account_id, l.net, case when p_treatment = 'standard' then l.vat_rate else 0 end,
         case when p_treatment = 'standard' then l.vat_amount else 0 end, l.item_id, l.unit, l.quantity, l.unit_price, l.discount_pct
    from ledger_document_lines(p_org, p_lines, 'invoice') l order by l.pos;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Quotes: the same lines as an invoice. Accepting one raises the invoice.
-- ---------------------------------------------------------------------------

create type quote_status as enum ('draft', 'sent', 'accepted', 'declined');

create table quotes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  customer_id     uuid not null,
  number          text not null,
  issued_on       date not null,
  valid_until     date,
  vat_treatment   vat_treatment not null default 'standard',
  net             numeric(14, 2) not null default 0,
  vat_amount      numeric(14, 2) not null default 0,
  total           numeric(14, 2) generated always as (net + vat_amount) stored,
  status          quote_status not null default 'draft',
  notes           text,
  invoice_id      uuid,
  accepted_on     date,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, number),
  foreign key (organisation_id, customer_id) references customers (organisation_id, id),
  foreign key (organisation_id, invoice_id) references invoices (organisation_id, id)
);

-- ---------------------------------------------------------------------------
-- A link that lets a customer read one of the company's invoices or quotes
-- without signing in, sent by WhatsApp, Viber, SMS or email. The token is the
-- link: whoever holds it reads that one document, until the link is stopped.
-- When it was opened is kept, and a quote accepted from it; the invoice is
-- still raised by the company, in Ledgerline.
-- ---------------------------------------------------------------------------
create table document_links (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  invoice_id      uuid,
  quote_id        uuid,
  token           text not null unique check (token ~ '^[A-Za-z0-9_-]{32}$'),
  created_by      uuid references app_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  views           integer not null default 0 check (views >= 0),
  -- A quote accepted by its customer from the link, in the name they typed.
  accepted_at     timestamptz,
  accepted_name   text check (accepted_name is null or length(btrim(accepted_name)) between 2 and 200),
  constraint document_links_one check (num_nonnulls(invoice_id, quote_id) = 1),
  constraint document_links_accepted check (accepted_at is null or (quote_id is not null and accepted_name is not null)),
  foreign key (organisation_id, invoice_id) references invoices (organisation_id, id) on delete cascade,
  foreign key (organisation_id, quote_id) references quotes (organisation_id, id) on delete cascade
);
-- One link at a time to each document: a new one is made only after the last is stopped.
create unique index document_links_open on document_links (coalesce(invoice_id, quote_id)) where revoked_at is null;
create index document_links_org on document_links (organisation_id);

create table quote_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  quote_id        uuid not null,
  position        smallint not null,
  description     text not null,
  account_id      uuid not null,
  item_id         uuid references items (id) on delete set null,
  unit            text,
  quantity        numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price      numeric(14, 4) check (unit_price >= 0),
  discount_pct    numeric(5, 2) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  net             numeric(14, 2) not null check (net >= 0),
  vat_rate        numeric(5, 2) not null default 19 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  vat_amount      numeric(14, 2) not null default 0,
  unique (quote_id, position),
  foreign key (organisation_id, quote_id) references quotes (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);

create function save_quote(p_org uuid, p_id uuid, p_customer_id uuid, p_number text, p_issued_on date, p_valid_until date,
  p_treatment vat_treatment, p_notes text, p_lines jsonb)
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_net numeric(14, 2); v_vat numeric(14, 2);
begin
  select coalesce(sum(l.net), 0), coalesce(sum(l.vat_amount), 0) into v_net, v_vat from ledger_document_lines(p_org, p_lines, 'quote') l;
  if p_treatment <> 'standard' then v_vat := 0; end if;
  if v_id is null then
    insert into quotes (organisation_id, customer_id, number, issued_on, valid_until, vat_treatment, net, vat_amount, notes)
    values (p_org, p_customer_id, btrim(p_number), p_issued_on, p_valid_until, p_treatment, v_net, v_vat, nullif(btrim(p_notes), ''))
    returning id into v_id;
  else
    update quotes set customer_id = p_customer_id, number = btrim(p_number), issued_on = p_issued_on, valid_until = p_valid_until,
           vat_treatment = p_treatment, net = v_net, vat_amount = v_vat, notes = nullif(btrim(p_notes), '')
     where id = v_id and organisation_id = p_org and status in ('draft', 'sent');
    if not found then raise exception 'quote_closed: an accepted or declined quote cannot be edited' using errcode = '23514'; end if;
    delete from quote_lines where quote_id = v_id;
  end if;
  insert into quote_lines (organisation_id, quote_id, position, description, account_id, net, vat_rate, vat_amount, item_id, unit, quantity, unit_price, discount_pct)
  select p_org, v_id, l.pos, l.description, l.account_id, l.net, case when p_treatment = 'standard' then l.vat_rate else 0 end,
         case when p_treatment = 'standard' then l.vat_amount else 0 end, l.item_id, l.unit, l.quantity, l.unit_price, l.discount_pct
    from ledger_document_lines(p_org, p_lines, 'quote') l order by l.pos;
  return v_id;
end $$;

-- The customer said yes: raise the invoice with the quote's very lines, and close the quote.
create function accept_quote(p_quote_id uuid, p_number text, p_issued_on date, p_due_on date) returns uuid language plpgsql as $$
declare v quotes; v_invoice uuid; v_lines jsonb;
begin
  select * into v from quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = '23503'; end if;
  if v.status in ('accepted', 'declined') then raise exception 'quote_closed: this quote is already %', v.status using errcode = '23514'; end if;
  select jsonb_agg(jsonb_build_object('description', description, 'account_id', account_id, 'net', net, 'vat_rate', vat_rate, 'vat_amount', vat_amount,
                   'item_id', item_id, 'unit', unit, 'quantity', quantity, 'unit_price', unit_price, 'discount_pct', discount_pct) order by position)
    into v_lines from quote_lines where quote_id = p_quote_id;
  v_invoice := save_invoice(v.organisation_id, null, v.customer_id, p_number, p_issued_on, p_due_on, v.vat_treatment,
    coalesce(v.notes, '') || case when v.notes is null then '' else ' ' end || '(From quote ' || v.number || '.)', v_lines, 'issued');
  update quotes set status = 'accepted', accepted_on = p_issued_on, invoice_id = v_invoice where id = p_quote_id;
  return v_invoice;
end $$;


-- ---------------------------------------------------------------------------
-- Credit notes: a sale taken back, in whole or in part, under its own number.
-- Cyprus VAT law corrects an issued invoice this way, never by editing it.
-- ---------------------------------------------------------------------------

create type credit_note_status as enum ('draft', 'issued', 'void');

create table credit_notes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations (id) on delete cascade,
  customer_id      uuid not null,
  invoice_id       uuid,
  number           text not null,
  issued_on        date not null,
  vat_treatment    vat_treatment not null default 'standard',
  reason           text not null,
  net              numeric(14, 2) not null default 0,
  vat_amount       numeric(14, 2) not null default 0,
  total            numeric(14, 2) generated always as (net + vat_amount) stored,
  amount_allocated numeric(14, 2) not null default 0 check (amount_allocated >= 0),
  amount_refunded  numeric(14, 2) not null default 0 check (amount_refunded >= 0),
  status           credit_note_status not null default 'issued',
  notes            text,
  created_at       timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, number),
  foreign key (organisation_id, customer_id) references customers (organisation_id, id),
  foreign key (organisation_id, invoice_id) references invoices (organisation_id, id),
  constraint credit_notes_not_overused check (amount_allocated + amount_refunded <= net + vat_amount),
  constraint credit_notes_vat_treatment check (vat_treatment = 'standard' or vat_amount = 0)
);

create table credit_note_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  credit_note_id  uuid not null,
  position        smallint not null,
  description     text not null,
  account_id      uuid not null,
  item_id         uuid references items (id) on delete set null,
  unit            text,
  quantity        numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price      numeric(14, 4) check (unit_price >= 0),
  discount_pct    numeric(5, 2) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  net             numeric(14, 2) not null check (net >= 0),
  vat_rate        numeric(5, 2) not null default 19 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  vat_amount      numeric(14, 2) not null default 0,
  unique (credit_note_id, position),
  foreign key (organisation_id, credit_note_id) references credit_notes (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);

-- A credit set against one of the customer's invoices. It posts nothing: both sides are the customer's account.
create table credit_allocations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  credit_note_id  uuid not null,
  invoice_id      uuid not null,
  amount          numeric(14, 2) not null check (amount > 0),
  allocated_on    date not null,
  created_at      timestamptz not null default now(),
  foreign key (organisation_id, credit_note_id) references credit_notes (organisation_id, id) on delete cascade,
  foreign key (organisation_id, invoice_id) references invoices (organisation_id, id) on delete cascade
);
create index credit_allocations_invoice_idx on credit_allocations (invoice_id);
create index credit_allocations_note_idx on credit_allocations (credit_note_id);

-- A refund is money spent from the bank against the credit; see post_bank_transaction.
alter table bank_transactions add foreign key (organisation_id, credit_note_id) references credit_notes (organisation_id, id);
create index bank_transactions_credit_note_idx on bank_transactions (credit_note_id) where credit_note_id is not null;

-- The reverse of an invoice: each line's account gives back its net, the VAT due falls, the customer owes less.
create function post_credit_note(p_id uuid) returns void language plpgsql as $$
declare v credit_notes; v_org uuid; v_customer text; v_lines jsonb;
begin
  select * into v from credit_notes where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'credit_note' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'credit_note', p_id, null, null, null, null); end if;
    return;
  end if;
  if v.status <> 'issued' then
    perform ledger_replace(v.organisation_id, 'credit_note', p_id, null, null, null, null);
    return;
  end if;
  select name into v_customer from customers where id = v.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', net, 'description', description)), '[]'::jsonb)
    into v_lines
    from (select account_id, sum(net) as net, min(description) as description from credit_note_lines where credit_note_id = p_id group by account_id) grouped;
  perform ledger_replace(v.organisation_id, 'credit_note', p_id, v.issued_on, v.number,
    'Credit note ' || v.number || coalesce(' · ' || v_customer, ''),
    v_lines || jsonb_build_array(
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'vat'), 'debit', v.vat_amount, 'is_tax', true),
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'receivable'), 'credit', v.total)
    ));
end $$;

create function post_credit_note_trigger() returns trigger language plpgsql as $$
begin perform post_credit_note(coalesce(new.id, old.id)); return null; end $$;
create function post_credit_note_lines_trigger() returns trigger language plpgsql as $$
begin perform post_credit_note(coalesce(new.credit_note_id, old.credit_note_id)); return null; end $$;
create constraint trigger credit_note_ledger after insert or update or delete on credit_notes
  deferrable initially deferred for each row execute function post_credit_note_trigger();
create constraint trigger credit_note_lines_ledger after insert or update or delete on credit_note_lines
  deferrable initially deferred for each row execute function post_credit_note_lines_trigger();

-- What has been allocated and refunded, kept on the credit note.
create function sync_credit_note(p_id uuid) returns void language plpgsql as $$
begin
  update credit_notes n
     set amount_allocated = coalesce((select sum(a.amount) from credit_allocations a where a.credit_note_id = p_id), 0),
         amount_refunded = coalesce((select sum(t.amount) from bank_transactions t where t.credit_note_id = p_id), 0)
   where n.id = p_id;
end $$;

create function guard_credit_allocation() returns trigger language plpgsql as $$
declare v_note record; v_invoice record;
begin
  select status, customer_id, total, amount_allocated, amount_refunded into v_note from credit_notes where id = new.credit_note_id for update;
  select status, customer_id, total, amount_paid, amount_credited into v_invoice from invoices where id = new.invoice_id for update;
  if v_note.status is distinct from 'issued' then
    raise exception 'credit_note_closed: only an issued credit note can be used' using errcode = '23514';
  end if;
  if v_invoice.status not in ('issued', 'part_paid') then
    raise exception 'invoice_payment_closed: only an invoice still owed can take a credit' using errcode = '23514';
  end if;
  if v_note.customer_id <> v_invoice.customer_id then
    raise exception 'credit_customer: a credit can only go against the same customer''s invoices' using errcode = '23514';
  end if;
  if new.amount > v_note.total - v_note.amount_allocated - v_note.amount_refunded then
    raise exception 'credit_notes_not_overused: that is more credit than is left on this credit note' using errcode = '23514';
  end if;
  if new.amount > v_invoice.total - v_invoice.amount_paid - v_invoice.amount_credited then
    raise exception 'invoices_not_overpaid: that is more than the balance on this invoice' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger credit_allocation_guard before insert on credit_allocations for each row execute function guard_credit_allocation();

create function sync_credit_allocation() returns trigger language plpgsql as $$
begin
  perform sync_credit_note(coalesce(new.credit_note_id, old.credit_note_id));
  perform sync_invoice_balance(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
create trigger credit_allocation_sync after insert or delete on credit_allocations for each row execute function sync_credit_allocation();

create function guard_credit_refund() returns trigger language plpgsql as $$
declare v_note record;
begin
  if new.credit_note_id is null then return new; end if;
  select status, total, amount_allocated, amount_refunded into v_note from credit_notes where id = new.credit_note_id for update;
  if v_note.status is distinct from 'issued' then
    raise exception 'credit_note_closed: only an issued credit note can be refunded' using errcode = '23514';
  end if;
  if new.kind <> 'spend' then raise exception 'bank_refund: a refund is money spent' using errcode = '23514'; end if;
  if new.amount > v_note.total - v_note.amount_allocated - v_note.amount_refunded then
    raise exception 'credit_notes_not_overused: that is more credit than is left on this credit note' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger credit_refund_guard before insert on bank_transactions for each row execute function guard_credit_refund();

create function sync_credit_refund() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' and old.credit_note_id is not null then perform sync_credit_note(old.credit_note_id); end if;
  if tg_op <> 'DELETE' and new.credit_note_id is not null then perform sync_credit_note(new.credit_note_id); end if;
  return null;
end $$;
create trigger credit_refund_sync after insert or update or delete on bank_transactions for each row execute function sync_credit_refund();

-- Issued against an invoice still owed: the credit goes against it at once, as far as it will go.
create function apply_credit_to_invoice(p_id uuid) returns void language plpgsql as $$
declare v credit_notes; v_balance numeric(14, 2); v_amount numeric(14, 2);
begin
  select * into v from credit_notes where id = p_id;
  if v.id is null or v.invoice_id is null or v.status <> 'issued' then return; end if;
  select total - amount_paid - amount_credited into v_balance from invoices where id = v.invoice_id and status in ('issued', 'part_paid');
  v_amount := least(coalesce(v_balance, 0), v.total - v.amount_allocated - v.amount_refunded);
  if v_amount > 0 then
    insert into credit_allocations (organisation_id, credit_note_id, invoice_id, amount, allocated_on)
    values (v.organisation_id, p_id, v.invoice_id, v_amount, v.issued_on);
  end if;
end $$;

create function save_credit_note(p_org uuid, p_id uuid, p_customer_id uuid, p_invoice_id uuid, p_number text, p_issued_on date,
  p_treatment vat_treatment, p_reason text, p_notes text, p_lines jsonb, p_status credit_note_status default 'issued')
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_net numeric(14, 2); v_vat numeric(14, 2); v_invoice invoices; v_credited numeric(14, 2);
begin
  if p_invoice_id is not null then
    select * into v_invoice from invoices where id = p_invoice_id and organisation_id = p_org;
    if v_invoice.id is null or v_invoice.customer_id <> p_customer_id or v_invoice.status not in ('issued', 'part_paid', 'paid') then
      raise exception 'credit_invoice: a credit note corrects an issued invoice to the same customer' using errcode = '23514';
    end if;
  end if;
  select coalesce(sum(l.net), 0), coalesce(sum(l.vat_amount), 0) into v_net, v_vat from ledger_document_lines(p_org, p_lines, 'credit note') l;
  if p_treatment <> 'standard' then v_vat := 0; end if;
  -- Never more back than the invoice charged, counting the credit notes already issued against it.
  if v_invoice.id is not null then
    select coalesce(sum(total), 0) into v_credited from credit_notes where invoice_id = p_invoice_id and status = 'issued' and id is distinct from v_id;
    if v_net + v_vat > v_invoice.total - v_credited then
      raise exception 'credit_exceeds_invoice: that is more than is left to credit on invoice %', v_invoice.number using errcode = '23514';
    end if;
  end if;
  if v_id is null then
    insert into credit_notes (organisation_id, customer_id, invoice_id, number, issued_on, vat_treatment, reason, net, vat_amount, notes, status)
    values (p_org, p_customer_id, p_invoice_id, btrim(p_number), p_issued_on, p_treatment, coalesce(nullif(btrim(p_reason), ''), 'Correction'),
            v_net, v_vat, nullif(btrim(p_notes), ''), p_status)
    returning id into v_id;
  else
    update credit_notes set customer_id = p_customer_id, invoice_id = p_invoice_id, number = btrim(p_number), issued_on = p_issued_on,
           vat_treatment = p_treatment, reason = coalesce(nullif(btrim(p_reason), ''), 'Correction'), net = v_net, vat_amount = v_vat, notes = nullif(btrim(p_notes), '')
     where id = v_id and organisation_id = p_org and status = 'draft';
    if not found then raise exception 'credit_note_closed: only a draft credit note can be edited' using errcode = '23514'; end if;
    delete from credit_note_lines where credit_note_id = v_id;
  end if;
  insert into credit_note_lines (organisation_id, credit_note_id, position, description, account_id, net, vat_rate, vat_amount, item_id, unit, quantity, unit_price, discount_pct)
  select p_org, v_id, l.pos, l.description, l.account_id, l.net, case when p_treatment = 'standard' then l.vat_rate else 0 end,
         case when p_treatment = 'standard' then l.vat_amount else 0 end, l.item_id, l.unit, l.quantity, l.unit_price, l.discount_pct
    from ledger_document_lines(p_org, p_lines, 'credit note') l order by l.pos;
  if p_status = 'issued' then perform apply_credit_to_invoice(v_id); end if;
  return v_id;
end $$;

create function issue_credit_note(p_id uuid) returns void language plpgsql as $$
begin
  update credit_notes set status = 'issued' where id = p_id and status = 'draft';
  if not found then raise exception 'credit_note_closed: only a draft credit note can be issued' using errcode = '23514'; end if;
  perform apply_credit_to_invoice(p_id);
end $$;

-- Void: the credit comes off any invoice it was set against, which is owed again. A refunded credit stays.
create function set_credit_note_void(p_id uuid, p_void boolean) returns void language plpgsql as $$
begin
  if p_void then
    if exists (select 1 from bank_transactions where credit_note_id = p_id) then
      raise exception 'credit_note_refunded: remove the refund before voiding this credit note' using errcode = '23514';
    end if;
    delete from credit_allocations where credit_note_id = p_id;
    update credit_notes set status = 'void' where id = p_id and status = 'issued';
    if not found then raise exception 'credit_note_closed: only an issued credit note can be voided' using errcode = '23514'; end if;
  else
    update credit_notes set status = 'issued' where id = p_id and status = 'void';
    if not found then raise exception 'credit_note_closed: only a void credit note can be restored' using errcode = '23514'; end if;
    perform apply_credit_to_invoice(p_id);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Credit notes from suppliers: a bill taken back, in whole or in part,
-- recorded as the supplier sent it. It lowers what is owed to them, the cost,
-- and the VAT reclaimed; set against a bill, or refunded into the bank.
-- ---------------------------------------------------------------------------

create type supplier_credit_status as enum ('recorded', 'void');

create table supplier_credits (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisations (id) on delete cascade,
  supplier_id        uuid not null,
  bill_id            uuid,
  number             text,
  issued_on          date not null,
  net                numeric(14, 2) not null default 0 check (net >= 0),
  vat_amount         numeric(14, 2) not null default 0 check (vat_amount >= 0),
  total              numeric(14, 2) generated always as (net + vat_amount) stored,
  reverse_charge     boolean not null default false,
  reverse_charge_vat numeric(14, 2) not null default 0,
  reverse_charge_kind text check (reverse_charge_kind in ('services', 'construction', 'import')),
  amount_allocated   numeric(14, 2) not null default 0 check (amount_allocated >= 0),
  amount_refunded    numeric(14, 2) not null default 0 check (amount_refunded >= 0),
  status             supplier_credit_status not null default 'recorded',
  notes              text,
  created_at         timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, supplier_id) references suppliers (organisation_id, id),
  foreign key (organisation_id, bill_id) references bills (organisation_id, id),
  constraint supplier_credits_not_overused check (amount_allocated + amount_refunded <= net + vat_amount),
  constraint supplier_credits_reverse_charge check (case when reverse_charge then vat_amount = 0 else reverse_charge_vat = 0 end)
);
create unique index supplier_credits_number_unique on supplier_credits (organisation_id, supplier_id, lower(btrim(number)))
  where number is not null and status <> 'void';

-- A document in the company's own currency unless it says otherwise, and a reverse charge that says which kind
-- (a Cyprus company's is always services from abroad).
create function document_currency() returns trigger language plpgsql as $$
begin
  if new.currency is null then select currency into new.currency from organisations where id = new.organisation_id; end if;
  return new;
end $$;
create trigger invoices_currency before insert on invoices for each row execute function document_currency();
create trigger bills_currency before insert on bills for each row execute function document_currency();

create function reverse_charge_kind() returns trigger language plpgsql as $$
begin
  new.reverse_charge_kind := case when new.reverse_charge then coalesce(new.reverse_charge_kind, 'services') end;
  return new;
end $$;
create trigger bills_reverse_charge_kind before insert or update on bills for each row execute function reverse_charge_kind();
create trigger bank_transactions_reverse_charge_kind before insert or update on bank_transactions for each row execute function reverse_charge_kind();
create trigger supplier_credits_reverse_charge_kind before insert or update on supplier_credits for each row execute function reverse_charge_kind();

create table supplier_credit_lines (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null,
  supplier_credit_id uuid not null,
  position           smallint not null,
  description        text not null,
  account_id         uuid not null,
  net                numeric(14, 2) not null check (net >= 0),
  vat_rate           numeric(5, 2) not null default 19 check (vat_rate in (0, 3, 5, 9, 19, 20)),
  vat_amount         numeric(14, 2) not null default 0 check (vat_amount >= 0),
  unique (supplier_credit_id, position),
  foreign key (organisation_id, supplier_credit_id) references supplier_credits (organisation_id, id) on delete cascade,
  foreign key (organisation_id, account_id) references ledger_accounts (organisation_id, id)
);

-- A supplier's credit set against one of their bills. It posts nothing: both sides are what is owed to them.
create table supplier_credit_allocations (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null,
  supplier_credit_id uuid not null,
  bill_id            uuid not null,
  amount             numeric(14, 2) not null check (amount > 0),
  allocated_on       date not null,
  created_at         timestamptz not null default now(),
  foreign key (organisation_id, supplier_credit_id) references supplier_credits (organisation_id, id) on delete cascade,
  foreign key (organisation_id, bill_id) references bills (organisation_id, id) on delete cascade
);
create index supplier_credit_allocations_bill_idx on supplier_credit_allocations (bill_id);
create index supplier_credit_allocations_credit_idx on supplier_credit_allocations (supplier_credit_id);

alter table bank_transactions add foreign key (organisation_id, supplier_credit_id) references supplier_credits (organisation_id, id);
create index bank_transactions_supplier_credit_idx on bank_transactions (supplier_credit_id) where supplier_credit_id is not null;

-- The reverse of a bill: each line's account gives back its cost, the VAT reclaimed falls, and less is owed to the supplier.
create function post_supplier_credit(p_id uuid) returns void language plpgsql as $$
declare v supplier_credits; v_org uuid; v_supplier text; v_lines jsonb; v_registered boolean; v_vat uuid;
begin
  select * into v from supplier_credits where id = p_id;
  if not found then
    select organisation_id into v_org from journal_entries where source = 'supplier_credit' and source_id = p_id;
    if v_org is not null then perform ledger_replace(v_org, 'supplier_credit', p_id, null, null, null, null); end if;
    return;
  end if;
  if v.status = 'void' then
    perform ledger_replace(v.organisation_id, 'supplier_credit', p_id, null, null, null, null);
    return;
  end if;
  v_vat := ledger_system_account(v.organisation_id, 'vat');
  select vat_registered into v_registered from organisations where id = v.organisation_id;
  select name into v_supplier from suppliers where id = v.supplier_id;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'credit', amount, 'description', description)), '[]'::jsonb)
    into v_lines
    from (select account_id, sum(net + case when v_registered or v.reverse_charge then 0 else vat_amount end) as amount, min(description) as description
            from supplier_credit_lines where supplier_credit_id = p_id group by account_id) grouped;
  perform ledger_replace(v.organisation_id, 'supplier_credit', p_id, v.issued_on, v.number,
    'Supplier credit · ' || v_supplier || coalesce(' ' || v.number, ''),
    v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_vat, 'credit', case when v_registered then v.vat_amount else 0 end, 'is_tax', true),
      jsonb_build_object('account_id', v_vat, 'credit', v.reverse_charge_vat, 'is_tax', true, 'description', 'Reverse charge: VAT reclaimed, taken back'),
      jsonb_build_object('account_id', v_vat, 'debit', v.reverse_charge_vat, 'is_tax', true, 'description', 'Reverse charge: VAT due, taken back'),
      jsonb_build_object('account_id', ledger_system_account(v.organisation_id, 'payable'), 'debit', v.total)
    ));
end $$;

create function post_supplier_credit_trigger() returns trigger language plpgsql as $$
begin perform post_supplier_credit(coalesce(new.id, old.id)); return null; end $$;
create function post_supplier_credit_lines_trigger() returns trigger language plpgsql as $$
begin perform post_supplier_credit(coalesce(new.supplier_credit_id, old.supplier_credit_id)); return null; end $$;
create constraint trigger supplier_credit_ledger after insert or update or delete on supplier_credits
  deferrable initially deferred for each row execute function post_supplier_credit_trigger();
create constraint trigger supplier_credit_lines_ledger after insert or update or delete on supplier_credit_lines
  deferrable initially deferred for each row execute function post_supplier_credit_lines_trigger();

create function sync_supplier_credit(p_id uuid) returns void language plpgsql as $$
begin
  update supplier_credits c
     set amount_allocated = coalesce((select sum(a.amount) from supplier_credit_allocations a where a.supplier_credit_id = p_id), 0),
         amount_refunded = coalesce((select sum(t.amount) from bank_transactions t where t.supplier_credit_id = p_id), 0)
   where c.id = p_id;
end $$;

create function guard_supplier_credit_allocation() returns trigger language plpgsql as $$
declare v_credit record; v_bill record;
begin
  select status, supplier_id, total, amount_allocated, amount_refunded into v_credit from supplier_credits where id = new.supplier_credit_id for update;
  select status, supplier_id, total, amount_paid, amount_credited into v_bill from bills where id = new.bill_id for update;
  if v_credit.status is distinct from 'recorded' then
    raise exception 'supplier_credit_closed: a void credit note cannot be used' using errcode = '23514';
  end if;
  if v_bill.status not in ('awaiting_payment', 'part_paid') then
    raise exception 'bill_payment_closed: only a bill still owed can take a credit' using errcode = '23514';
  end if;
  if v_credit.supplier_id <> v_bill.supplier_id then
    raise exception 'credit_supplier: a credit can only go against the same supplier''s bills' using errcode = '23514';
  end if;
  if new.amount > v_credit.total - v_credit.amount_allocated - v_credit.amount_refunded then
    raise exception 'supplier_credits_not_overused: that is more credit than is left on this credit note' using errcode = '23514';
  end if;
  if new.amount > v_bill.total - v_bill.amount_paid - v_bill.amount_credited then
    raise exception 'bills_not_overpaid: that is more than the balance on this bill' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger supplier_credit_allocation_guard before insert on supplier_credit_allocations for each row execute function guard_supplier_credit_allocation();

create function sync_supplier_credit_allocation() returns trigger language plpgsql as $$
begin
  perform sync_supplier_credit(coalesce(new.supplier_credit_id, old.supplier_credit_id));
  perform sync_bill_balance(coalesce(new.bill_id, old.bill_id));
  return null;
end $$;
create trigger supplier_credit_allocation_sync after insert or delete on supplier_credit_allocations for each row execute function sync_supplier_credit_allocation();

create function guard_supplier_refund() returns trigger language plpgsql as $$
declare v_credit record;
begin
  if new.supplier_credit_id is null then return new; end if;
  select status, total, amount_allocated, amount_refunded into v_credit from supplier_credits where id = new.supplier_credit_id for update;
  if v_credit.status is distinct from 'recorded' then
    raise exception 'supplier_credit_closed: a void credit note cannot be refunded' using errcode = '23514';
  end if;
  if new.kind <> 'receive' then raise exception 'bank_refund: a refund from a supplier is money received' using errcode = '23514'; end if;
  if new.amount > v_credit.total - v_credit.amount_allocated - v_credit.amount_refunded then
    raise exception 'supplier_credits_not_overused: that is more credit than is left on this credit note' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger supplier_refund_guard before insert on bank_transactions for each row execute function guard_supplier_refund();

create function sync_supplier_refund() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' and old.supplier_credit_id is not null then perform sync_supplier_credit(old.supplier_credit_id); end if;
  if tg_op <> 'DELETE' and new.supplier_credit_id is not null then perform sync_supplier_credit(new.supplier_credit_id); end if;
  return null;
end $$;
create trigger supplier_refund_sync after insert or update or delete on bank_transactions for each row execute function sync_supplier_refund();

-- Recorded against a bill still owed: the credit goes against it at once, as far as it will go.
create function apply_supplier_credit_to_bill(p_id uuid) returns void language plpgsql as $$
declare v supplier_credits; v_balance numeric(14, 2); v_amount numeric(14, 2);
begin
  select * into v from supplier_credits where id = p_id;
  if v.id is null or v.bill_id is null or v.status <> 'recorded' then return; end if;
  select total - amount_paid - amount_credited into v_balance from bills where id = v.bill_id and status in ('awaiting_payment', 'part_paid');
  v_amount := least(coalesce(v_balance, 0), v.total - v.amount_allocated - v.amount_refunded);
  if v_amount > 0 then
    insert into supplier_credit_allocations (organisation_id, supplier_credit_id, bill_id, amount, allocated_on)
    values (v.organisation_id, p_id, v.bill_id, v_amount, v.issued_on);
  end if;
end $$;

create function save_supplier_credit(p_org uuid, p_id uuid, p_supplier_id uuid, p_bill_id uuid, p_number text, p_issued_on date,
  p_notes text, p_lines jsonb, p_reverse_charge boolean default false, p_reverse_charge_kind text default null)
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_net numeric(14, 2); v_vat numeric(14, 2); v_rc boolean := coalesce(p_reverse_charge, false); v_bill bills; v_credited numeric(14, 2);
begin
  if p_bill_id is not null then
    select * into v_bill from bills where id = p_bill_id and organisation_id = p_org;
    if v_bill.id is null or v_bill.supplier_id <> p_supplier_id or v_bill.status = 'void' then
      raise exception 'credit_bill: a supplier''s credit note corrects one of their bills' using errcode = '23514';
    end if;
  end if;
  select coalesce(sum(l.net), 0), coalesce(sum(l.vat_amount), 0) into v_net, v_vat from ledger_document_lines(p_org, p_lines, 'supplier credit') l;
  -- Never more back than the bill charged, counting the credit notes already recorded against it.
  if v_bill.id is not null then
    select coalesce(sum(total), 0) into v_credited from supplier_credits where bill_id = p_bill_id and status = 'recorded' and id is distinct from v_id;
    if v_net + (case when v_rc then 0 else v_vat end) > v_bill.total - v_credited then
      raise exception 'credit_exceeds_bill: that is more than is left to credit on this bill' using errcode = '23514';
    end if;
  end if;
  if v_id is null then
    insert into supplier_credits (organisation_id, supplier_id, bill_id, number, issued_on, net, vat_amount, reverse_charge, reverse_charge_vat, reverse_charge_kind, notes)
    values (p_org, p_supplier_id, p_bill_id, nullif(btrim(p_number), ''), p_issued_on, v_net, case when v_rc then 0 else v_vat end, v_rc,
            case when v_rc then v_vat else 0 end, p_reverse_charge_kind, nullif(btrim(p_notes), ''))
    returning id into v_id;
  else
    if exists (select 1 from bank_transactions where supplier_credit_id = v_id) then
      raise exception 'supplier_credit_refunded: remove the refund before changing this credit note' using errcode = '23514';
    end if;
    delete from supplier_credit_allocations where supplier_credit_id = v_id;
    update supplier_credits set supplier_id = p_supplier_id, bill_id = p_bill_id, number = nullif(btrim(p_number), ''), issued_on = p_issued_on,
           net = v_net, vat_amount = case when v_rc then 0 else v_vat end, reverse_charge = v_rc, reverse_charge_vat = case when v_rc then v_vat else 0 end,
           reverse_charge_kind = p_reverse_charge_kind, notes = nullif(btrim(p_notes), '')
     where id = v_id and organisation_id = p_org and status = 'recorded';
    if not found then raise exception 'supplier_credit_closed: a void credit note cannot be changed' using errcode = '23514'; end if;
    delete from supplier_credit_lines where supplier_credit_id = v_id;
  end if;
  insert into supplier_credit_lines (organisation_id, supplier_credit_id, position, description, account_id, net, vat_rate, vat_amount)
  select p_org, v_id, l.pos, l.description, l.account_id, l.net, l.vat_rate, l.vat_amount from ledger_document_lines(p_org, p_lines, 'supplier credit') l order by l.pos;
  perform apply_supplier_credit_to_bill(v_id);
  return v_id;
end $$;

-- Void: the credit comes off the bills it was set against, which are owed again. A refunded credit stays.
create function set_supplier_credit_void(p_id uuid, p_void boolean) returns void language plpgsql as $$
begin
  if p_void then
    if exists (select 1 from bank_transactions where supplier_credit_id = p_id) then
      raise exception 'supplier_credit_refunded: remove the refund before voiding this credit note' using errcode = '23514';
    end if;
    delete from supplier_credit_allocations where supplier_credit_id = p_id;
    update supplier_credits set status = 'void' where id = p_id and status = 'recorded';
    if not found then raise exception 'supplier_credit_closed: this credit note is already void' using errcode = '23514'; end if;
  else
    update supplier_credits set status = 'recorded' where id = p_id and status = 'void';
    if not found then raise exception 'supplier_credit_closed: only a void credit note can be restored' using errcode = '23514'; end if;
    perform apply_supplier_credit_to_bill(p_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Repeating invoices: the same invoice raised every month, quarter or year.
-- Nothing runs in the background: invoices that have come due are raised
-- when someone asks, each on its own date and with its own number.
-- ---------------------------------------------------------------------------

create table repeating_invoices (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  customer_id     uuid not null,
  name            text not null,
  every_months    smallint not null check (every_months in (1, 2, 3, 6, 12)),
  -- The day of the month it falls on, kept across shorter months.
  day_of_month    smallint not null check (day_of_month between 1 and 31),
  next_on         date not null,
  ends_on         date,
  -- Issue each invoice at once, or save it as a draft for someone to check and issue.
  issue           boolean not null default true,
  vat_treatment   vat_treatment not null default 'standard',
  notes           text,
  lines           jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 200),
  is_active       boolean not null default true,
  raised          integer not null default 0,
  last_invoice_id uuid references invoices (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, customer_id) references customers (organisation_id, id),
  constraint repeating_invoices_ends check (ends_on is null or ends_on >= next_on or not is_active)
);
alter table invoices add column repeating_id uuid references repeating_invoices (id) on delete set null;

-- The date `p_months` on, on the same day of the month, or the month's last day when it is shorter.
create function next_repeat_date(p_from date, p_months integer, p_day integer) returns date language sql immutable as $$
  select (date_trunc('month', p_from) + make_interval(months => p_months))::date
       + (least(p_day, extract(day from date_trunc('month', p_from) + make_interval(months => p_months + 1) - interval '1 day')::integer) - 1);
$$;

-- Raise the invoice that is due, numbered as asked, dated its due date, on the customer's terms; then move on to the next.
create function raise_repeating_invoice(p_id uuid, p_number text, p_today date) returns uuid language plpgsql as $$
declare v repeating_invoices; v_terms integer; v_invoice uuid; v_next date;
begin
  select * into v from repeating_invoices where id = p_id for update;
  if v.id is null or not v.is_active or v.next_on > p_today or (v.ends_on is not null and v.next_on > v.ends_on) then
    raise exception 'repeat_not_due: this repeating invoice is not due' using errcode = '23514';
  end if;
  select coalesce(c.payment_terms_days, o.payment_terms_days) into v_terms
    from customers c join organisations o on o.id = c.organisation_id where c.id = v.customer_id;
  v_invoice := save_invoice(v.organisation_id, null, v.customer_id, p_number, v.next_on, v.next_on + v_terms, v.vat_treatment, v.notes, v.lines,
                            case when v.issue then 'issued'::invoice_status else 'draft'::invoice_status end);
  update invoices set repeating_id = p_id where id = v_invoice;
  v_next := next_repeat_date(v.next_on, v.every_months, v.day_of_month);
  update repeating_invoices
     set next_on = v_next, raised = raised + 1, last_invoice_id = v_invoice,
         is_active = case when ends_on is not null and v_next > ends_on then false else is_active end
   where id = p_id;
  return v_invoice;
end $$;

create function save_bank_transaction(p_org uuid, p_id uuid, p_kind bank_transaction_kind, p_bank_account_id uuid, p_transfer_account_id uuid,
  p_date date, p_contact text, p_reference text, p_amount numeric, p_lines jsonb, p_reverse_charge boolean default false, p_reverse_charge_kind text default null)
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_net numeric(14, 2) := 0; v_vat numeric(14, 2) := 0; v_rc boolean := coalesce(p_reverse_charge, false) and p_kind = 'spend';
begin
  if not exists (select 1 from ledger_accounts where id = p_bank_account_id and organisation_id = p_org and type = 'bank' and is_active)
     or (p_kind = 'transfer' and not exists (select 1 from ledger_accounts where id = p_transfer_account_id and organisation_id = p_org and type = 'bank' and is_active)) then
    raise exception 'ledger_bank_required: choose an active bank account' using errcode = '23514';
  end if;
  if p_kind = 'transfer' then
    if coalesce(p_amount, 0) <= 0 then raise exception 'ledger_amount_required: a transfer needs an amount' using errcode = '23514'; end if;
  else
    select coalesce(sum(l.net), 0), coalesce(sum(l.vat_amount), 0) into v_net, v_vat
      from ledger_document_lines(p_org, p_lines, case when p_kind = 'spend' then 'payment' else 'receipt' end) l;
  end if;
  if v_id is null then
    insert into bank_transactions (organisation_id, kind, bank_account_id, transfer_account_id, txn_date, contact, reference, amount, net, vat_amount, reverse_charge, reverse_charge_vat, reverse_charge_kind)
    values (p_org, p_kind, p_bank_account_id, case when p_kind = 'transfer' then p_transfer_account_id end, p_date,
            nullif(btrim(p_contact), ''), nullif(btrim(p_reference), ''),
            case when p_kind = 'transfer' then round(p_amount, 2) when v_rc then v_net else v_net + v_vat end, v_net,
            case when v_rc then 0 else v_vat end, v_rc, case when v_rc then v_vat else 0 end, p_reverse_charge_kind)
    returning id into v_id;
  else
    update bank_transactions set kind = p_kind, bank_account_id = p_bank_account_id, transfer_account_id = case when p_kind = 'transfer' then p_transfer_account_id end,
           txn_date = p_date, contact = nullif(btrim(p_contact), ''), reference = nullif(btrim(p_reference), ''),
           amount = case when p_kind = 'transfer' then round(p_amount, 2) when v_rc then v_net else v_net + v_vat end, net = v_net,
           vat_amount = case when v_rc then 0 else v_vat end, reverse_charge = v_rc, reverse_charge_vat = case when v_rc then v_vat else 0 end,
           reverse_charge_kind = p_reverse_charge_kind, updated_at = now()
     where id = v_id and organisation_id = p_org;
    if not found then raise exception 'Bank transaction not found' using errcode = '23503'; end if;
    delete from bank_transaction_lines where transaction_id = v_id;
  end if;
  if exists (select 1 from bank_transactions where id = v_id and (credit_note_id is not null or supplier_credit_id is not null)) then
    raise exception 'bank_refund: a refund is changed from its credit note' using errcode = '23514';
  end if;
  if p_kind <> 'transfer' then
    insert into bank_transaction_lines (organisation_id, transaction_id, position, description, account_id, net, vat_rate, vat_amount)
    select p_org, v_id, l.pos, l.description, l.account_id, l.net, l.vat_rate, l.vat_amount
      from ledger_document_lines(p_org, p_lines, case when p_kind = 'spend' then 'payment' else 'receipt' end) l order by l.pos;
  end if;
  return v_id;
end $$;

create function delete_bank_transaction(p_id uuid) returns void language plpgsql as $$
begin delete from bank_transactions where id = p_id; end $$;

create function save_manual_journal(p_org uuid, p_id uuid, p_date date, p_reference text, p_narration text, p_lines jsonb)
returns uuid language plpgsql as $$
declare v_id uuid := p_id; v_lock date := org_lock_date(p_org); v_old date; v_line jsonb; v_pos integer := 0; v_debit numeric := 0; v_credit numeric := 0; d numeric; c numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 2 and 200 then
    raise exception 'journal_lines_required: a journal needs at least two lines' using errcode = '23514';
  end if;
  if coalesce(btrim(p_narration), '') = '' then raise exception 'journal_narration_required: say what the journal is for' using errcode = '23514'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    d := round(coalesce((v_line->>'debit')::numeric, 0), 2); c := round(coalesce((v_line->>'credit')::numeric, 0), 2);
    if d < 0 or c < 0 or (d > 0) = (c > 0) then raise exception 'journal_line_side: line % needs either a debit or a credit', v_pos using errcode = '23514'; end if;
    if not exists (select 1 from ledger_accounts where id = nullif(v_line->>'account_id', '')::uuid and organisation_id = p_org and is_active) then
      raise exception 'journal_line_account: line % needs an active account', v_pos using errcode = '23514';
    end if;
    v_debit := v_debit + d; v_credit := v_credit + c;
  end loop;
  if v_debit <> v_credit then raise exception 'journal_unbalanced: debits and credits must be equal' using errcode = '23514'; end if;
  if v_lock is not null and p_date <= v_lock then raise exception 'period_locked: the books are locked up to %', v_lock using errcode = '23514'; end if;
  if v_id is null then
    insert into journal_entries (organisation_id, entry_date, source, reference, narration)
    values (p_org, p_date, 'manual', nullif(btrim(p_reference), ''), btrim(p_narration)) returning id into v_id;
  else
    select entry_date into v_old from journal_entries where id = v_id and organisation_id = p_org and source = 'manual';
    if not found then raise exception 'Journal not found' using errcode = '23503'; end if;
    if v_lock is not null and v_old <= v_lock then raise exception 'period_locked: the books are locked up to %', v_lock using errcode = '23514'; end if;
    update journal_entries set entry_date = p_date, reference = nullif(btrim(p_reference), ''), narration = btrim(p_narration) where id = v_id;
    delete from journal_lines where entry_id = v_id;
  end if;
  insert into journal_lines (organisation_id, entry_id, account_id, debit, credit, description)
  select p_org, v_id, (l->>'account_id')::uuid, round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         nullif(left(btrim(coalesce(l->>'description', '')), 300), '')
    from jsonb_array_elements(p_lines) l;
  return v_id;
end $$;

create function delete_manual_journal(p_id uuid) returns void language plpgsql as $$
declare v_lock date; v_date date; v_org uuid;
begin
  select entry_date, organisation_id into v_date, v_org from journal_entries where id = p_id and source = 'manual';
  if not found then raise exception 'Journal not found' using errcode = '23503'; end if;
  v_lock := org_lock_date(v_org);
  if v_lock is not null and v_date <= v_lock then raise exception 'period_locked: the books are locked up to %', v_lock using errcode = '23514'; end if;
  delete from journal_entries where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Reading the books
-- ---------------------------------------------------------------------------

create function ledger_balances(p_org uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type ledger_account_type, system_role text, is_active boolean,
               opening numeric, debit numeric, credit numeric)
language sql stable as $$
  select a.id, a.code, a.name, a.type, a.system_role, a.is_active,
         coalesce(sum(l.debit - l.credit) filter (where e.entry_date < p_from), 0),
         coalesce(sum(l.debit) filter (where e.entry_date between p_from and p_to), 0),
         coalesce(sum(l.credit) filter (where e.entry_date between p_from and p_to), 0)
    from ledger_accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_entries e on e.id = l.entry_id and e.entry_date <= p_to
   where a.organisation_id = p_org
   group by a.id
   order by a.code;
$$;

create function cash_movements(p_org uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type ledger_account_type, system_role text, amount numeric)
language sql stable as $$
  select a.id, a.code, a.name, a.type, a.system_role, sum(l.credit - l.debit)
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join ledger_accounts a on a.id = l.account_id
   where e.organisation_id = p_org and e.entry_date between p_from and p_to and a.type <> 'bank'
     and exists (select 1 from journal_lines bl join ledger_accounts ba on ba.id = bl.account_id where bl.entry_id = e.id and ba.type = 'bank')
   group by a.id
  having sum(l.credit - l.debit) <> 0
   order by a.code;
$$;

create function cash_by_month(p_org uuid, p_from date, p_to date)
returns table (month date, money_in numeric, money_out numeric)
language sql stable as $$
  select date_trunc('month', c.entry_date)::date,
         coalesce(sum(c.cash) filter (where c.cash > 0), 0),
         coalesce(-sum(c.cash) filter (where c.cash < 0), 0)
    from (select e.id, e.entry_date, sum(l.debit - l.credit) as cash
            from journal_entries e
            join journal_lines l on l.entry_id = e.id
            join ledger_accounts a on a.id = l.account_id
           where e.organisation_id = p_org and a.type = 'bank' and e.entry_date between p_from and p_to
           group by e.id, e.entry_date) c
   group by 1 order by 1;
$$;

create function vat_summary(p_org uuid, p_from date, p_to date)
returns table (output_vat numeric, input_vat numeric, sales_net numeric, purchases_net numeric)
language sql stable as $$
  -- A credit note to a customer reduces the VAT due (box 1); it is not VAT reclaimed (box 4).
  -- A supplier's credit note reduces the VAT reclaimed (box 4), and under the reverse charge the VAT due too.
  select coalesce(sum(l.credit) filter (where l.is_tax and e.source <> 'supplier_credit'), 0)
           - coalesce(sum(l.debit) filter (where l.is_tax and e.source in ('credit_note', 'supplier_credit')), 0),
         coalesce(sum(l.debit) filter (where l.is_tax and e.source not in ('credit_note', 'supplier_credit')), 0)
           - coalesce(sum(l.credit) filter (where l.is_tax and e.source = 'supplier_credit'), 0),
         coalesce(sum(l.credit - l.debit) filter (where not l.is_tax and a.type in ('revenue', 'other_income') and e.source in ('invoice', 'bank', 'credit_note')), 0),
         -- Wages, social insurance, PAYE and the like are never on a VAT return (ledger_accounts.outside_vat).
         coalesce(sum(l.debit - l.credit) filter (where not l.is_tax and a.type in ('direct_costs', 'expense', 'depreciation', 'fixed_asset', 'current_asset')
                                                  and a.system_role is null and not a.outside_vat and e.source in ('bill', 'bank', 'supplier_credit')), 0)
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join ledger_accounts a on a.id = l.account_id
   where e.organisation_id = p_org and e.entry_date between p_from and p_to;
$$;

-- Sales by VAT treatment (net) and services bought under the reverse charge.
create function vat_breakdown(p_org uuid, p_from date, p_to date)
returns table (standard_sales numeric, zero_rated_sales numeric, exempt_sales numeric, reverse_charge_sales numeric,
               outside_scope_sales numeric, reverse_charge_purchases numeric, reverse_charge_vat numeric)
language sql stable as $$
  with sales as (
    select vat_treatment, sum(net) filter (where vat_rate > 0) as rated, sum(net) filter (where vat_rate = 0) as zero
      from (select i.vat_treatment, l.net, l.vat_rate
              from invoices i join invoice_lines l on l.invoice_id = i.id
             where i.organisation_id = p_org and i.status in ('issued', 'part_paid', 'paid') and i.currency = (select currency from organisations where id = p_org) and i.issued_on between p_from and p_to
            union all
            -- Credit notes come off the sales of the period they are issued in.
            select n.vat_treatment, -l.net, l.vat_rate
              from credit_notes n join credit_note_lines l on l.credit_note_id = n.id
             where n.organisation_id = p_org and n.status = 'issued' and n.issued_on between p_from and p_to) s
     group by vat_treatment
  ), purchases as (
    select sum(net) as net, sum(reverse_charge_vat) as vat from (
      select b.net, b.reverse_charge_vat from bills b where b.organisation_id = p_org and b.reverse_charge and b.status <> 'void' and b.issued_on between p_from and p_to
      union all
      select t.net, t.reverse_charge_vat from bank_transactions t where t.organisation_id = p_org and t.reverse_charge and t.txn_date between p_from and p_to
      union all
      select -c.net, -c.reverse_charge_vat from supplier_credits c where c.organisation_id = p_org and c.reverse_charge and c.status = 'recorded' and c.issued_on between p_from and p_to
    ) rc
  )
  select coalesce((select rated from sales where vat_treatment = 'standard'), 0),
         coalesce((select zero from sales where vat_treatment = 'standard'), 0),
         coalesce((select coalesce(rated, 0) + coalesce(zero, 0) from sales where vat_treatment = 'exempt'), 0),
         coalesce((select coalesce(rated, 0) + coalesce(zero, 0) from sales where vat_treatment = 'reverse_charge'), 0),
         coalesce((select coalesce(rated, 0) + coalesce(zero, 0) from sales where vat_treatment = 'outside_scope'), 0),
         coalesce((select net from purchases), 0),
         coalesce((select vat from purchases), 0);
$$;

-- What a UK VAT return is made from, for one period (VAT Notice 700/12 and 733, checked 27 Oct 2026).
-- By invoice date; or under cash accounting, by the day money moved, each payment split between net and VAT
-- in its document's own proportion. Reverse charges are apart, by kind, since each kind fills different boxes;
-- and single capital purchases of £2,000 or more with VAT, the only purchases the flat rate lets a business reclaim.
create function uk_vat_figures(p_org uuid, p_from date, p_to date, p_cash boolean)
returns table (sales_vat numeric, purchase_vat numeric, sales_net numeric, purchases_net numeric,
               rc_services_net numeric, rc_services_vat numeric, rc_construction_net numeric, rc_construction_vat numeric,
               rc_import_net numeric, rc_import_vat numeric, capital_net numeric, capital_vat numeric)
language sql stable as $$
  with rc as (
    select kind, sum(net) as net, sum(vat) as vat from (
      select b.reverse_charge_kind as kind, b.net, b.reverse_charge_vat as vat from bills b
       where b.organisation_id = p_org and b.reverse_charge and b.status <> 'void' and b.issued_on between p_from and p_to
      union all
      select t.reverse_charge_kind, t.net, t.reverse_charge_vat from bank_transactions t
       where t.organisation_id = p_org and t.reverse_charge and t.txn_date between p_from and p_to
      union all
      select c.reverse_charge_kind, -c.net, -c.reverse_charge_vat from supplier_credits c
       where c.organisation_id = p_org and c.reverse_charge and c.status = 'recorded' and c.issued_on between p_from and p_to
    ) x group by kind
  ), rc_vat as (select coalesce(sum(vat), 0) as vat from rc),
  -- By invoice date: the ledger's VAT less the reverse charges in it (vat_summary leaves out what is never on a return).
  accrual as (
    select s.output_vat - r.vat as sales_vat, s.input_vat - r.vat as purchase_vat, s.sales_net, s.purchases_net
      from vat_summary(p_org, p_from, p_to) s, rc_vat r
  ),
  -- By the day money moved: invoices and bills as they are paid, the bank's own entries as they happen.
  received as (
    select coalesce(sum(p.amount * i.vat_amount / nullif(i.total, 0)), 0) as vat, coalesce(sum(p.amount * i.net / nullif(i.total, 0)), 0) as net
      from invoice_payments p join invoices i on i.id = p.invoice_id
     where p.organisation_id = p_org and p.received_on between p_from and p_to
  ), paid as (
    select coalesce(sum(p.amount * b.vat_amount / nullif(b.total, 0)), 0) as vat,
           coalesce(sum(p.amount * (select coalesce(sum(l.net), 0) from bill_lines l join ledger_accounts a on a.id = l.account_id where l.bill_id = b.id and not a.outside_vat) / nullif(b.total, 0)), 0) as net
      from bill_payments p join bills b on b.id = p.bill_id
     where p.organisation_id = p_org and p.paid_on between p_from and p_to
  ), banked as (
    select coalesce(sum(l.vat_amount) filter (where t.kind = 'receive'), 0) as sales_vat,
           coalesce(sum(l.net) filter (where t.kind = 'receive' and a.type in ('revenue', 'other_income')), 0) as sales_net,
           coalesce(sum(l.vat_amount) filter (where t.kind = 'spend' and not t.reverse_charge), 0) as purchase_vat,
           coalesce(sum(l.net) filter (where t.kind = 'spend' and not a.outside_vat and a.system_role is null
                                         and a.type in ('direct_costs', 'expense', 'depreciation', 'fixed_asset', 'current_asset')), 0) as purchases_net
      from bank_transactions t join bank_transaction_lines l on l.transaction_id = t.id join ledger_accounts a on a.id = l.account_id
     where t.organisation_id = p_org and t.txn_date between p_from and p_to
  ), capital as (
    select coalesce(sum(net), 0) as net, coalesce(sum(vat), 0) as vat from (
      select l.net, l.vat_amount as vat from bill_lines l join bills b on b.id = l.bill_id join ledger_accounts a on a.id = l.account_id
       where b.organisation_id = p_org and b.status <> 'void' and not b.reverse_charge and b.issued_on between p_from and p_to
         and a.type = 'fixed_asset' and l.net + l.vat_amount >= 2000
      union all
      select l.net, l.vat_amount from bank_transaction_lines l join bank_transactions t on t.id = l.transaction_id join ledger_accounts a on a.id = l.account_id
       where t.organisation_id = p_org and t.kind = 'spend' and not t.reverse_charge and t.txn_date between p_from and p_to
         and a.type = 'fixed_asset' and l.net + l.vat_amount >= 2000
    ) x
  )
  select case when p_cash then received.vat + banked.sales_vat else accrual.sales_vat end,
         case when p_cash then paid.vat + banked.purchase_vat else accrual.purchase_vat end,
         case when p_cash then received.net + banked.sales_net else accrual.sales_net end,
         case when p_cash then paid.net + banked.purchases_net else accrual.purchases_net end,
         coalesce((select net from rc where kind = 'services'), 0), coalesce((select vat from rc where kind = 'services'), 0),
         coalesce((select net from rc where kind = 'construction'), 0), coalesce((select vat from rc where kind = 'construction'), 0),
         coalesce((select net from rc where kind = 'import'), 0), coalesce((select vat from rc where kind = 'import'), 0),
         capital.net, capital.vat
    from accrual, received, paid, banked, capital;
$$;

create view v_journal_lines as
select l.id, l.organisation_id, l.entry_id, e.entry_date, e.source, e.source_id, e.reference, e.narration,
       l.account_id, a.code as account_code, a.name as account_name, a.type as account_type,
       l.debit, l.credit, l.is_tax, l.description, e.created_at
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join ledger_accounts a on a.id = l.account_id;

create view v_bill_directory as
select b.*, (b.total - b.amount_paid - b.amount_credited) as balance, s.name as supplier_name, s.iban as supplier_iban,
       case when b.status in ('awaiting_payment', 'part_paid') and b.due_on is not null
            then greatest(0, (now() at time zone 'Asia/Nicosia')::date - b.due_on) else 0 end as days_overdue,
       coalesce(b.number, '') || ' ' || s.name || ' ' || coalesce(b.reference, '') as search_text
  from bills b join suppliers s on s.id = b.supplier_id;

create view v_invoice_directory as
select i.*, (i.total - i.amount_paid - i.amount_credited) as balance, c.name as client_name, c.vat_number as client_vat_number, c.country as client_country,
       case when i.status in ('issued', 'part_paid') and i.due_on is not null
            then greatest(0, (now() at time zone 'Asia/Nicosia')::date - i.due_on) else 0 end as days_overdue
  from invoices i join customers c on c.id = i.customer_id;

create view v_quote_directory as
select q.*, c.name as client_name, c.vat_number as client_vat_number, c.country as client_country, inv.number as invoice_number,
       (q.status = 'sent' and q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Nicosia')::date) as expired
  from quotes q join customers c on c.id = q.customer_id left join invoices inv on inv.id = q.invoice_id;

create view v_supplier_credit_directory as
select c.*, (c.total - c.amount_allocated - c.amount_refunded) as remaining, s.name as supplier_name, b.number as bill_number
  from supplier_credits c join suppliers s on s.id = c.supplier_id left join bills b on b.id = c.bill_id;

create view v_credit_note_directory as
select n.*, (n.total - n.amount_allocated - n.amount_refunded) as remaining, c.name as client_name, c.vat_number as client_vat_number,
       c.country as client_country, inv.number as invoice_number
  from credit_notes n join customers c on c.id = n.customer_id left join invoices inv on inv.id = n.invoice_id;

create view v_bank_transaction_directory as
select t.*, a.name as bank_account_name, ta.name as transfer_account_name
  from bank_transactions t
  join ledger_accounts a on a.id = t.bank_account_id
  left join ledger_accounts ta on ta.id = t.transfer_account_id;

-- ---------------------------------------------------------------------------
-- Bank statements and reconciliation
-- ---------------------------------------------------------------------------

create table bank_statement_imports (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  bank_account_id uuid not null,
  source          text not null check (source in ('file', 'feed')),
  file_name       text,
  added           integer not null default 0,
  skipped         integer not null default 0,
  first_date      date,
  last_date       date,
  closing_balance numeric(14, 2),
  imported_by     uuid,
  imported_at     timestamptz not null default now(),
  foreign key (organisation_id, bank_account_id) references ledger_accounts (organisation_id, id)
);

create table bank_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  bank_account_id uuid not null,
  import_id       uuid references bank_statement_imports (id) on delete set null,
  txn_date        date not null,
  amount          numeric(14, 2) not null check (amount <> 0),
  description     text not null,
  reference       text,
  counterparty    text,
  balance         numeric(14, 2),
  external_id     text not null,
  excluded_at     timestamptz,
  excluded_by     uuid,
  excluded_reason text,
  -- Whether anything is matched to it, kept by the matches themselves (bank_line_matched): so what is left to match is found
  -- from a small index, however many lines a practice's clients have.
  matched         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (bank_account_id, external_id),
  foreign key (organisation_id, bank_account_id) references ledger_accounts (organisation_id, id)
);
create index bank_statement_lines_account_date_idx on bank_statement_lines (bank_account_id, txn_date desc);
create index bank_statement_lines_unmatched_idx on bank_statement_lines (organisation_id, txn_date) where not matched and excluded_at is null;

create table bank_line_matches (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null,
  line_id             uuid not null references bank_statement_lines (id) on delete cascade,
  bank_account_id     uuid not null,
  invoice_payment_id  uuid references invoice_payments (id) on delete cascade,
  bill_payment_id     uuid references bill_payments (id) on delete cascade,
  bank_transaction_id uuid references bank_transactions (id) on delete cascade,
  matched_by          uuid,
  matched_at          timestamptz not null default now(),
  constraint bank_line_matches_one_document check (num_nonnulls(invoice_payment_id, bill_payment_id, bank_transaction_id) = 1)
);
create index bank_line_matches_line_idx on bank_line_matches (line_id);
create index bank_line_matches_org_at_idx on bank_line_matches (organisation_id, matched_at);

-- A line is matched while anything is matched to it. Kept here so no one has to count matches to know. Owner's rights: it
-- only ever marks the line the match is on.
create function bank_line_matched() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ledgerline.seeding', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then update bank_statement_lines set matched = true where id = new.line_id and not matched;
  else update bank_statement_lines set matched = exists (select 1 from bank_line_matches where line_id = old.line_id) where id = old.line_id;
  end if;
  return null;
end $$;
create trigger bank_line_matches_matched after insert or delete on bank_line_matches for each row execute function bank_line_matched();
create unique index bank_line_matches_invoice_payment_unique on bank_line_matches (invoice_payment_id) where invoice_payment_id is not null;
create unique index bank_line_matches_bill_payment_unique on bank_line_matches (bill_payment_id) where bill_payment_id is not null;
create unique index bank_line_matches_bank_transaction_unique on bank_line_matches (bank_transaction_id, bank_account_id) where bank_transaction_id is not null;

create function bank_match_effect(p_bank uuid, p_invoice_payment uuid, p_bill_payment uuid, p_bank_transaction uuid)
returns numeric language sql stable as $$
  select case
    when p_invoice_payment is not null then (
      select coalesce(sum(l.debit - l.credit), 0) from journal_entries e join journal_lines l on l.entry_id = e.id
       where e.source = 'invoice_payment' and e.source_id = p_invoice_payment and l.account_id = p_bank)
    when p_bill_payment is not null then (
      select coalesce(sum(l.debit - l.credit), 0) from journal_entries e join journal_lines l on l.entry_id = e.id
       where e.source = 'bill_payment' and e.source_id = p_bill_payment and l.account_id = p_bank)
    else (
      select case
               when t.kind = 'spend' and t.bank_account_id = p_bank then -t.amount
               when t.kind = 'receive' and t.bank_account_id = p_bank then t.amount
               when t.kind = 'transfer' and t.bank_account_id = p_bank then -t.amount
               when t.kind = 'transfer' and t.transfer_account_id = p_bank then t.amount
               else 0 end
        from bank_transactions t where t.id = p_bank_transaction)
  end;
$$;

create function import_bank_statement(p_bank_account_id uuid, p_source text, p_file_name text, p_closing_balance numeric, p_lines jsonb)
returns jsonb language plpgsql as $$
declare
  v_org uuid; v_import uuid; v_line jsonb; v_pos integer := 0; v_added integer := 0;
  v_date date; v_amount numeric(14, 2); v_desc text; v_key text; v_rows integer;
begin
  select organisation_id into v_org from ledger_accounts where id = p_bank_account_id and type = 'bank' and is_active;
  if v_org is null then raise exception 'ledger_bank_required: choose an active bank account' using errcode = '23514'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 5000 then
    raise exception 'bank_statement_lines: a statement needs between 1 and 5,000 lines' using errcode = '23514';
  end if;
  insert into bank_statement_imports (organisation_id, bank_account_id, source, file_name, closing_balance)
  values (v_org, p_bank_account_id, p_source, left(nullif(btrim(p_file_name), ''), 200), round(p_closing_balance, 2))
  returning id into v_import;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    v_date := (v_line->>'date')::date;
    v_amount := round((v_line->>'amount')::numeric, 2);
    v_desc := left(btrim(coalesce(nullif(btrim(v_line->>'description'), ''), nullif(btrim(v_line->>'counterparty'), ''), nullif(btrim(v_line->>'reference'), ''), '')), 500);
    v_key := left(btrim(coalesce(v_line->>'external_id', '')), 200);
    if v_date is null or v_amount is null or v_amount = 0 or v_desc = '' or v_key = '' then
      raise exception 'bank_statement_line: line % needs a date, an amount and a description', v_pos using errcode = '23514';
    end if;
    insert into bank_statement_lines (organisation_id, bank_account_id, import_id, txn_date, amount, description, reference, counterparty, balance, external_id)
    values (v_org, p_bank_account_id, v_import, v_date, v_amount, v_desc,
            left(nullif(btrim(v_line->>'reference'), ''), 200), left(nullif(btrim(v_line->>'counterparty'), ''), 200),
            round(nullif(v_line->>'balance', '')::numeric, 2), v_key)
    on conflict (bank_account_id, external_id) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;
  update bank_statement_imports
     set added = v_added, skipped = v_pos - v_added,
         first_date = (select min((l->>'date')::date) from jsonb_array_elements(p_lines) l),
         last_date = (select max((l->>'date')::date) from jsonb_array_elements(p_lines) l)
   where id = v_import;
  return jsonb_build_object('import_id', v_import, 'added', v_added, 'skipped', v_pos - v_added);
end $$;

create function reconcile_bank_line(p_line_id uuid, p_items jsonb) returns void language plpgsql as $$
declare
  v_line bank_statement_lines; v_item jsonb; v_kind text; v_id uuid; v_ref text; v_total numeric(14, 2); v_zero integer;
begin
  select * into v_line from bank_statement_lines where id = p_line_id for update;
  if not found then raise exception 'Bank line not found' using errcode = '23503'; end if;
  if v_line.excluded_at is not null then raise exception 'bank_line_excluded: include the line again before matching it' using errcode = '23514'; end if;
  if exists (select 1 from bank_line_matches where line_id = p_line_id) then
    raise exception 'bank_line_matched: this line is already matched; unmatch it first' using errcode = '23514';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'bank_match_items: choose what this line was' using errcode = '23514';
  end if;
  v_ref := left(coalesce(nullif(btrim(v_line.reference), ''), v_line.description), 120);
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item->>'kind';
    v_id := nullif(v_item->>'id', '')::uuid;
    if v_kind = 'invoice' then
      insert into invoice_payments (organisation_id, invoice_id, received_on, amount, method, reference, bank_account_id)
      values (v_line.organisation_id, (v_item->>'invoice_id')::uuid, v_line.txn_date, round((v_item->>'amount')::numeric, 2), 'bank_transfer', v_ref, v_line.bank_account_id)
      returning id into v_id;
      v_kind := 'invoice_payment';
    elsif v_kind = 'bill' then
      insert into bill_payments (organisation_id, bill_id, paid_on, amount, bank_account_id, method, reference)
      values (v_line.organisation_id, (v_item->>'bill_id')::uuid, v_line.txn_date, round((v_item->>'amount')::numeric, 2), v_line.bank_account_id, 'bank_transfer', v_ref)
      returning id into v_id;
      v_kind := 'bill_payment';
    elsif v_kind in ('spend', 'receive') then
      v_id := save_bank_transaction(v_line.organisation_id, null, v_kind::bank_transaction_kind, v_line.bank_account_id, null, v_line.txn_date,
        coalesce(nullif(btrim(v_item->>'contact'), ''), v_line.counterparty), v_ref, null, v_item->'lines');
      v_kind := 'bank_transaction';
    elsif v_kind = 'transfer' then
      if v_line.amount < 0 then
        v_id := save_bank_transaction(v_line.organisation_id, null, 'transfer', v_line.bank_account_id, (v_item->>'account_id')::uuid, v_line.txn_date, null, v_ref, -v_line.amount, null);
      else
        v_id := save_bank_transaction(v_line.organisation_id, null, 'transfer', (v_item->>'account_id')::uuid, v_line.bank_account_id, v_line.txn_date, null, v_ref, v_line.amount, null);
      end if;
      v_kind := 'bank_transaction';
    elsif v_kind not in ('invoice_payment', 'bill_payment', 'bank_transaction') or v_id is null then
      raise exception 'bank_match_items: one of the choices is not something a bank line can be' using errcode = '23514';
    end if;
    insert into bank_line_matches (organisation_id, line_id, bank_account_id, invoice_payment_id, bill_payment_id, bank_transaction_id)
    values (v_line.organisation_id, p_line_id, v_line.bank_account_id,
            case when v_kind = 'invoice_payment' then v_id end,
            case when v_kind = 'bill_payment' then v_id end,
            case when v_kind = 'bank_transaction' then v_id end);
  end loop;
  -- Bank transactions post when the statement ends; post them now so their effect can be checked.
  perform post_bank_transaction(m.bank_transaction_id) from bank_line_matches m where m.line_id = p_line_id and m.bank_transaction_id is not null;
  select coalesce(sum(bank_match_effect(m.bank_account_id, m.invoice_payment_id, m.bill_payment_id, m.bank_transaction_id)), 0),
         count(*) filter (where bank_match_effect(m.bank_account_id, m.invoice_payment_id, m.bill_payment_id, m.bank_transaction_id) = 0)
    into v_total, v_zero
    from bank_line_matches m where m.line_id = p_line_id;
  if v_zero > 0 then raise exception 'bank_match_account: something chosen does not go through this bank account' using errcode = '23514'; end if;
  if v_total <> v_line.amount then
    raise exception 'bank_match_total: the matched amounts come to %, the bank line is %', v_total, v_line.amount using errcode = '23514';
  end if;
end $$;

create function unmatch_bank_line(p_line_id uuid) returns void language plpgsql as $$
begin delete from bank_line_matches where line_id = p_line_id; end $$;

create function set_bank_line_excluded(p_line_id uuid, p_excluded boolean, p_reason text) returns void language plpgsql as $$
begin
  if p_excluded and exists (select 1 from bank_line_matches where line_id = p_line_id) then
    raise exception 'bank_line_matched: this line is already matched; unmatch it first' using errcode = '23514';
  end if;
  update bank_statement_lines
     set excluded_at = case when p_excluded then now() end,
         excluded_reason = case when p_excluded then left(nullif(btrim(p_reason), ''), 300) end
   where id = p_line_id;
  if not found then raise exception 'Bank line not found' using errcode = '23503'; end if;
end $$;

create function delete_bank_statement_import(p_import_id uuid) returns integer language plpgsql as $$
declare v_removed integer;
begin
  delete from bank_statement_lines l where l.import_id = p_import_id and not exists (select 1 from bank_line_matches m where m.line_id = l.id);
  get diagnostics v_removed = row_count;
  delete from bank_statement_imports i where i.id = p_import_id and not exists (select 1 from bank_statement_lines l where l.import_id = i.id);
  return v_removed;
end $$;

create view v_bank_statement_lines as
select l.*,
       coalesce(m.matched_amount, 0) as matched_amount,
       coalesce(m.match_count, 0)::integer as match_count,
       case when l.excluded_at is not null then 'excluded'
            when coalesce(m.match_count, 0) = 0 then 'unmatched'
            when coalesce(m.matched_amount, 0) = l.amount then 'matched'
            else 'partial' end as status
  from bank_statement_lines l
  left join lateral (
    select count(*) as match_count,
           sum(bank_match_effect(x.bank_account_id, x.invoice_payment_id, x.bill_payment_id, x.bank_transaction_id)) as matched_amount
      from bank_line_matches x where x.line_id = l.id
  ) m on true;

-- The bank lines nobody has matched yet: what the dashboards and the year end count, at any number of clients. Working out
-- a line's full status (v_bank_statement_lines) means valuing every match; matching only succeeds when the values add up,
-- so a line whose match later stops adding up is the rare case, shown on its bank account's own page.
create view v_bank_lines_unmatched as
select l.* from bank_statement_lines l where not l.matched and l.excluded_at is null;

create function unreconciled_bank_items(p_bank_account_id uuid)
returns table (kind text, id uuid, item_date date, amount numeric, label text, reference text, document_id uuid)
language sql stable as $$
  select 'invoice_payment', p.id, p.received_on, bank_match_effect(p_bank_account_id, p.id, null, null),
         'Invoice ' || i.number || coalesce(' · ' || c.name, ''), p.reference, i.id
    from invoice_payments p
    join invoices i on i.id = p.invoice_id
    join customers c on c.id = i.customer_id
   where p.bank_account_id = p_bank_account_id
     and not exists (select 1 from bank_line_matches m where m.invoice_payment_id = p.id)
  union all
  select 'bill_payment', p.id, p.paid_on, -p.amount, 'Bill' || coalesce(' ' || b.number, '') || ' · ' || s.name, p.reference, b.id
    from bill_payments p
    join bills b on b.id = p.bill_id
    join suppliers s on s.id = b.supplier_id
   where p.bank_account_id = p_bank_account_id
     and not exists (select 1 from bank_line_matches m where m.bill_payment_id = p.id)
  union all
  select 'bank_transaction', t.id, t.txn_date, bank_match_effect(p_bank_account_id, null, null, t.id),
         case t.kind when 'spend' then 'Spent' when 'receive' then 'Received' else 'Transfer' end || coalesce(' · ' || t.contact, ''), t.reference, t.id
    from bank_transactions t
   where p_bank_account_id in (t.bank_account_id, t.transfer_account_id)
     and not exists (select 1 from bank_line_matches m where m.bank_transaction_id = t.id and m.bank_account_id = p_bank_account_id)
  order by 3, 2;
$$;

-- ---------------------------------------------------------------------------
-- VAT returns filed
-- ---------------------------------------------------------------------------

create table vat_returns (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  period_from     date not null,
  period_to       date not null,
  filed_on        date not null,
  net_vat         numeric(14, 2) not null,
  boxes           jsonb not null default '{}'::jsonb,
  unique (organisation_id, period_to)
);

-- ---------------------------------------------------------------------------
-- AI capture: files dropped at practice level, invoices found in them
-- ---------------------------------------------------------------------------

create table capture_files (
  id           uuid primary key default gen_random_uuid(),
  practice_id  uuid not null references practices (id) on delete cascade,
  -- Uploaded from inside one company's books: where a document goes when nothing on it names a client.
  organisation_id uuid references organisations (id) on delete set null,
  file_name    text not null,
  media_type   text not null,
  size_bytes   integer not null,
  sha256       text not null,
  content      bytea not null,
  status       text not null default 'queued' check (status in ('queued', 'reading', 'read', 'failed')),
  error        text,
  uploaded_at  timestamptz not null default now(),
  read_at      timestamptz
);

create table capture_items (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid not null references capture_files (id) on delete cascade,
  position        smallint not null default 1,
  organisation_id uuid references organisations (id) on delete set null,
  routing         jsonb not null default '{}'::jsonb,
  extraction      jsonb not null,
  checks          jsonb not null default '[]'::jsonb,
  supplier_id     uuid,
  draft           jsonb not null default '{}'::jsonb,
  status          text not null default 'review' check (status in ('review', 'posted', 'discarded')),
  bill_id         uuid,
  created_at      timestamptz not null default now(),
  posted_at       timestamptz
);

-- ---------------------------------------------------------------------------
-- Tamper-evident audit log: each row's hash covers the one before it.
-- ---------------------------------------------------------------------------

create table audit_log (
  seq             bigserial primary key,
  at              timestamptz not null default now(),
  organisation_id uuid,
  actor           text not null default 'system',
  action          text not null,
  entity          text not null,
  entity_id       uuid,
  detail          jsonb not null default '{}'::jsonb,
  prev_hash       text not null,
  hash            text not null
);
-- What the practice dashboard reads for each client's last activity: the latest of each, found through an index.
create index audit_log_org_at on audit_log (organisation_id, at);
create index capture_items_org_created on capture_items (organisation_id, created_at);
create index bank_statement_imports_org_at on bank_statement_imports (organisation_id, imported_at);

create function audit_hash(p_prev text, p_at timestamptz, p_org uuid, p_actor text, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_org::text, ''), p_actor, p_action,
                                            p_entity, coalesce(p_entity_id::text, ''), p_detail::text), 'UTF8')), 'hex');
$$;

-- Runs as the owner: nobody signed in can write to the audit log except through this.
create function audit_append(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text; v_at timestamptz := clock_timestamp();
  v_actor text := coalesce(nullif(current_setting('ledgerline.actor', true), ''), (select name from app_users where id = app_user_id()), 'system');
begin
  if coalesce(current_setting('ledgerline.seeding', true), '') = 'on' then return; end if;
  select hash into v_prev from audit_log order by seq desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into audit_log (at, organisation_id, actor, action, entity, entity_id, detail, prev_hash, hash)
  values (v_at, p_org, v_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb), v_prev,
          audit_hash(v_prev, v_at, p_org, v_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb)));
end $$;

create function audit_guard() returns trigger language plpgsql as $$
begin raise exception 'audit_log_append_only: the audit log cannot be changed' using errcode = '42501'; end $$;
create trigger audit_log_append_only before update or delete on audit_log for each row execute function audit_guard();

-- Every posting, and every match, lock and filing, goes on the chain.
create function audit_journal_entry() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform audit_append(new.organisation_id, 'posted', new.source::text, new.id,
      jsonb_build_object('date', new.entry_date, 'narration', new.narration, 'reference', new.reference));
    return new;
  end if;
  perform audit_append(old.organisation_id, 'reversed', old.source::text, old.id, jsonb_build_object('date', old.entry_date, 'narration', old.narration));
  return old;
end $$;
create trigger journal_entries_audit after insert or delete on journal_entries for each row execute function audit_journal_entry();

create function audit_match() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform audit_append(new.organisation_id, 'matched', 'bank_line', new.line_id, '{}'::jsonb);
    return new;
  end if;
  perform audit_append(old.organisation_id, 'unmatched', 'bank_line', old.line_id, '{}'::jsonb);
  return old;
end $$;
create trigger bank_line_matches_audit after insert or delete on bank_line_matches for each row execute function audit_match();

create function audit_organisation() returns trigger language plpgsql as $$
begin
  if new.lock_date is distinct from old.lock_date then
    perform audit_append(new.id, 'locked', 'books', new.id, jsonb_build_object('from', old.lock_date, 'to', new.lock_date));
  end if;
  return new;
end $$;
create trigger organisations_audit after update on organisations for each row execute function audit_organisation();

create function audit_vat_return() returns trigger language plpgsql as $$
begin
  perform audit_append(new.organisation_id, 'filed', 'vat_return', new.id, jsonb_build_object('from', new.period_from, 'to', new.period_to, 'net_vat', new.net_vat));
  return new;
end $$;
create trigger vat_returns_audit after insert on vat_returns for each row execute function audit_vat_return();

-- Recompute the chain: the first row whose hash or link does not hold, or none.
-- Runs as the owner: the chain is checked whole, though each person sees only their own companies' rows.
create function audit_verify() returns table (checked bigint, broken_at bigint) language plpgsql stable security definer set search_path = public as $$
declare r audit_log; v_prev text := repeat('0', 64); v_count bigint := 0;
begin
  for r in select * from audit_log order by seq loop
    v_count := v_count + 1;
    if r.prev_hash <> v_prev or r.hash <> audit_hash(r.prev_hash, r.at, r.organisation_id, r.actor, r.action, r.entity, r.entity_id, r.detail) then
      checked := v_count; broken_at := r.seq; return next; return;
    end if;
    v_prev := r.hash;
  end loop;
  checked := v_count; broken_at := null; return next;
end $$;

-- ---------------------------------------------------------------------------
-- The CRM, inside each client company: enquiries through to won, the
-- company's customers (the same customers as in its books), their people,
-- the work it does for them (its jobs, whatever it calls them), tasks and the
-- activity on each. How each company works is its own: what it calls these,
-- the stages they go through, the details it keeps, and the parts it uses.
-- ---------------------------------------------------------------------------

-- How a company works (lib/domain/business-types): what it calls its customers, its enquiries and its work, and the
-- parts beyond its books it uses. Set from its business type when it is opened; the company changes it afterwards.
create table workspace_settings (
  organisation_id uuid primary key references organisations (id) on delete cascade,
  customer_one    text not null default 'Customer',
  customer_many   text not null default 'Customers',
  deal_one        text not null default 'Enquiry',
  deal_many       text not null default 'Enquiries',
  job_one         text not null default 'Job',
  job_many        text not null default 'Jobs',
  modules         text[] not null default '{pipeline,quotes,jobs,tasks,products,payroll}'
                  check (modules <@ array['pipeline', 'quotes', 'jobs', 'tasks', 'products', 'payroll']::text[]),
  updated_at      timestamptz not null default now(),
  constraint workspace_settings_labels check (length(btrim(customer_one)) between 1 and 30 and length(btrim(customer_many)) between 1 and 30
    and length(btrim(deal_one)) between 1 and 30 and length(btrim(deal_many)) between 1 and 30 and length(btrim(job_one)) between 1 and 30 and length(btrim(job_many)) between 1 and 30)
);

-- The stages a company's enquiries (the 'deal' board) and its jobs (the 'job' board) go through, in order. Each board has
-- one stage that closes a record well (won; done) and one that closes it otherwise (lost; cancelled). A deal stage's
-- probability weighs the pipeline.
create table crm_stages (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  board           text not null check (board in ('deal', 'job')),
  name            text not null check (length(btrim(name)) between 1 and 40),
  position        smallint not null check (position > 0),
  outcome         text not null default 'open' check (outcome in ('open', 'won', 'lost')),
  probability     smallint check (probability between 0 and 100),
  created_at      timestamptz not null default now(),
  unique (organisation_id, id)
);
create unique index crm_stages_name on crm_stages (organisation_id, board, lower(btrim(name)));
create unique index crm_stages_one_won on crm_stages (organisation_id, board) where outcome = 'won';
create unique index crm_stages_one_lost on crm_stages (organisation_id, board) where outcome = 'lost';

-- The details a company keeps beyond the usual on its customers, enquiries and jobs: a vessel and its port, a site
-- address, a fee basis. Values live in each record's `extra`, by key. An archived field keeps its values, unshown.
create table custom_fields (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  entity          text not null check (entity in ('customer', 'deal', 'job')),
  key             text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label           text not null check (length(btrim(label)) between 1 and 60),
  kind            text not null check (kind in ('text', 'number', 'money', 'date', 'choice', 'yes_no', 'link')),
  options         text[] not null default '{}',
  position        smallint not null default 0,
  -- Shown on the record's card on its board, and as a column in its list.
  on_card         boolean not null default false,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organisation_id, entity, key),
  constraint custom_fields_options check (case when kind = 'choice' then cardinality(options) between 1 and 30 else cardinality(options) = 0 end)
);

create table crm_enquiries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations (id) on delete cascade,
  reference        text not null,
  full_name        text not null,
  company          text,
  email            text,
  phone            text,
  source           text not null default 'Website',
  -- How it reached the books: typed in by someone, sent from the company's website form, or posted to the API.
  channel          text not null default 'manual' check (channel in ('manual', 'form', 'api')),
  service          text,
  -- Filled with the company's first open stage when not given (crm_stage_check).
  stage_id         uuid not null,
  value            numeric(14, 2),
  expected_on      date,
  owner            text not null,
  priority         text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  next_action      text,
  next_action_due  date,
  summary          text,
  lost_reason      text,
  customer_id      uuid references customers (id) on delete set null,
  extra            jsonb not null default '{}' check (jsonb_typeof(extra) = 'object'),
  stage_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (organisation_id, reference),
  foreign key (organisation_id, stage_id) references crm_stages (organisation_id, id)
);

-- ---------------------------------------------------------------------------
-- The practice's own work: its people, the time they spend on each client,
-- each client's fee, and the fee invoices raised from the practice's books.
-- ---------------------------------------------------------------------------

create table practice_staff (
  id           uuid primary key default gen_random_uuid(),
  practice_id  uuid not null references practices (id) on delete cascade,
  name         text not null,
  role         text,
  weekly_hours numeric(4, 1) not null default 35 check (weekly_hours between 1 and 80),
  -- The money laundering compliance officer: approves the risk rating of low and normal risk clients.
  mlco         boolean not null default false,
  -- Their sign-in. Someone on the staff list without one (a part-time bookkeeper) is planned for but sees nothing.
  user_id      uuid references app_users (id) on delete set null,
  unique (practice_id, name),
  unique (practice_id, user_id)
);

-- People at a client company who use its books: its owner, its own staff. They see that company and nothing else.
create table company_members (
  organisation_id uuid not null references organisations (id) on delete cascade,
  user_id         uuid not null references app_users (id) on delete cascade,
  -- An owner or staff work in the books; a viewer and the company's auditor only read them.
  role            text not null default 'owner' check (role in ('owner', 'staff', 'viewer', 'auditor')),
  created_at      timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index company_members_user on company_members (user_id);

-- Asking someone to join: one of the practice's people, or one of a client company's own (organisation_id set).
-- The link carries a token; only its fingerprint is kept, so the table can't be used to join.
create table invitations (
  id              uuid primary key default gen_random_uuid(),
  practice_id     uuid not null references practices (id) on delete cascade,
  organisation_id uuid references organisations (id) on delete cascade,
  email           text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  name            text not null check (length(btrim(name)) between 2 and 200),
  -- At the practice: Partner, Manager, Accountant or Assistant. At a company: owner, staff or viewer.
  role            text not null,
  mlco            boolean not null default false,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by      uuid references app_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  accepted_at     timestamptz,
  accepted_by     uuid references app_users (id) on delete set null,
  revoked_at      timestamptz,
  constraint invitations_role check (case when organisation_id is null then role in ('Partner', 'Manager', 'Accountant', 'Assistant') else role in ('owner', 'staff', 'viewer', 'auditor') end),
  constraint invitations_mlco check (not mlco or organisation_id is null),
  constraint invitations_outcome check (accepted_at is null or revoked_at is null)
);
create unique index invitations_open on invitations (practice_id, coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), email)
  where accepted_at is null and revoked_at is null;

-- What one person has put away for themselves at a company: its getting-started steps, once they no longer need them.
create table user_dismissals (
  user_id         uuid not null references app_users (id) on delete cascade,
  organisation_id uuid not null references organisations (id) on delete cascade,
  what            text not null check (what in ('getting_started')),
  dismissed_at    timestamptz not null default now(),
  primary key (user_id, organisation_id, what)
);

-- What a client company pays the practice: a monthly fee, and a rate for extra work billed on top of it.
-- customer_id is that client as a customer in the practice's own books.
create table client_fees (
  organisation_id uuid primary key references organisations (id) on delete cascade,
  customer_id     uuid not null references customers (id),
  monthly_fee     numeric(12, 2) not null default 0 check (monthly_fee >= 0),
  hourly_rate     numeric(10, 2) not null default 60 check (hourly_rate >= 0),
  -- What the practice charges this client for using Ledgerline under the practice's name. Ledgerline bills the
  -- practice one fee whatever this is: the practice sets it, invoices it on its fee invoice, and keeps it.
  app_fee         numeric(10, 2) not null default 0 check (app_fee >= 0),
  updated_at      timestamptz not null default now()
);

-- Time spent on a client company (or on the practice's own work, against its own books).
-- A running timer has no end and no minutes yet; each person runs one at a time.
create table time_entries (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  person          text not null,
  work            text not null check (length(btrim(work)) between 1 and 200),
  started_at      timestamptz not null,
  ended_at        timestamptz,
  minutes         integer check (minutes between 1 and 1440),
  extra           boolean not null default false,
  invoice_id      uuid references invoices (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint time_entries_running check ((ended_at is null) = (minutes is null))
);
create unique index time_entries_one_running on time_entries (person) where ended_at is null;
create index time_entries_org_started on time_entries (organisation_id, started_at);

-- The fee invoice raised for a client and a month, so a month is never billed twice.
create table fee_invoices (
  client_organisation_id uuid not null references organisations (id) on delete cascade,
  period                 date not null check (extract(day from period) = 1),
  invoice_id             uuid not null references invoices (id) on delete cascade,
  primary key (client_organisation_id, period)
);

-- Every VAT number checked against VIES, the EU's register: the answer, the name and address the member
-- state gave, and the consultation number VIES issues when the company checking gives its own VAT number,
-- which is the evidence that the number was checked before a sale was zero-rated. Kept for good: a later
-- check is a new row. organisation_id is the company the check was made for (the requester).
create table vat_checks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  country         text not null check (country ~ '^[A-Z]{2}$'),
  number          text not null check (number ~ '^[A-Z0-9+*]{2,14}$'),
  valid           boolean,
  name            text,
  address         text,
  consultation    text,
  -- The name in the books, and whether the member state said it matches its register: some match without disclosing the name.
  asked_name      text,
  name_match      text check (name_match in ('match', 'differs')),
  error           text,
  source          text not null check (source in ('vies', 'demo')),
  checked_by      text not null,
  checked_at      timestamptz not null default now(),
  constraint vat_checks_answer check ((valid is null) = (error is not null))
);
create index vat_checks_number on vat_checks (country, number, checked_at desc);
-- The demo's companies are invented, so the real register has never heard of them. A check of one of
-- their numbers is answered from here and marked as a demo answer; every other number goes to VIES.
create table vies_demo_register (
  country text not null,
  number  text not null,
  valid   boolean not null default true,
  name    text,
  address text,
  primary key (country, number)
);

-- A check is evidence, so it goes on the audit chain.
create function audit_vat_check() returns trigger language plpgsql as $$
begin
  perform audit_append(new.organisation_id, 'checked', 'vat_number', new.id,
    jsonb_build_object('number', new.country || new.number, 'valid', new.valid, 'name', new.name, 'name_match', new.name_match, 'consultation', new.consultation, 'error', new.error, 'source', new.source));
  return new;
end $$;
create trigger vat_checks_audit after insert on vat_checks for each row execute function audit_vat_check();

-- Deadlines other than a VAT return (a VIES statement, a provisional tax
-- instalment, the company tax return) are marked done by hand. A VAT return
-- needs no mark: filing it in Ledgerline is what closes its deadline.
create table deadline_marks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  kind            text not null check (kind in ('vies', 'provisional_tax', 'tax_return', 'tax_payment', 'annual_return', 'payroll', 'employer_return', 'vat_payment', 'accounts_filing', 'confirmation_statement')),
  period_end      date not null,
  done_on         date not null,
  done_by         text not null,
  created_at      timestamptz not null default now(),
  unique (organisation_id, kind, period_end)
);

-- A company's website form key. It can do one thing, add an enquiry, so it is
-- public by design (it sits in the form's own HTML) and is kept as written so
-- the snippet can be shown again. One live key per company; a new key retires
-- the old one.
create table enquiry_form_keys (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  token           text not null unique check (token ~ '^ll_form_[A-Za-z0-9]{24}$'),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  uses            integer not null default 0,
  revoked_at      timestamptz
);
create unique index enquiry_form_keys_one_live on enquiry_form_keys (organisation_id) where revoked_at is null;

create table crm_contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  customer_id     uuid references customers (id) on delete cascade,
  name            text not null,
  role            text,
  email           text,
  phone           text,
  created_at      timestamptz not null default now()
);

-- The work a company does for its customers, whatever it calls it: jobs, projects, orders, bookings, treatment plans.
create table crm_jobs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations (id) on delete cascade,
  reference        text not null,
  title            text not null check (length(btrim(title)) between 1 and 200),
  customer_id      uuid references customers (id) on delete set null,
  enquiry_id       uuid references crm_enquiries (id) on delete set null,
  owner            text not null,
  -- Filled with the company's first open stage when not given (crm_stage_check).
  stage_id         uuid not null,
  priority         text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  value            numeric(14, 2) check (value >= 0),
  starts_on        date,
  due_on           date,
  next_action      text,
  next_action_due  date,
  summary          text,
  extra            jsonb not null default '{}' check (jsonb_typeof(extra) = 'object'),
  opened_on        date not null default current_date,
  -- The day it reached done or cancelled; none while it is open.
  closed_on        date,
  stage_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (organisation_id, reference),
  foreign key (organisation_id, stage_id) references crm_stages (organisation_id, id),
  constraint crm_jobs_dates check (due_on is null or starts_on is null or due_on >= starts_on)
);

-- A record's stage is one of its company's, on its own board. A new one starts in the first open stage; a deal lost says
-- why; a job closes on the day it reaches done or cancelled, and opens again if moved back.
create function crm_stage_check() returns trigger language plpgsql as $$
declare v_board text := case tg_table_name when 'crm_enquiries' then 'deal' else 'job' end; v_outcome text;
begin
  if new.stage_id is null then
    select id into new.stage_id from crm_stages where organisation_id = new.organisation_id and board = v_board and outcome = 'open' order by position limit 1;
  end if;
  select outcome into v_outcome from crm_stages where id = new.stage_id and organisation_id = new.organisation_id and board = v_board;
  if v_outcome is null then
    raise exception 'crm_stage_board: that is not one of this company''s % stages', case v_board when 'deal' then 'pipeline' else 'job' end using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then new.stage_changed_at := now(); end if;
  if v_board = 'deal' then
    if v_outcome = 'lost' and nullif(btrim(coalesce(new.lost_reason, '')), '') is null then
      raise exception 'crm_lost_reason: a lost enquiry needs its reason' using errcode = '23514';
    end if;
    if v_outcome <> 'lost' then new.lost_reason := null; end if;
  else
    new.closed_on := case when v_outcome = 'open' then null
      when tg_op = 'INSERT' then coalesce(new.closed_on, current_date)
      when old.stage_id = new.stage_id then coalesce(old.closed_on, current_date) else current_date end;
  end if;
  return new;
end $$;
create trigger crm_enquiries_stage before insert or update of stage_id, lost_reason on crm_enquiries for each row execute function crm_stage_check();
create trigger crm_jobs_stage before insert or update of stage_id on crm_jobs for each row execute function crm_stage_check();

create table crm_tasks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  title           text not null,
  due_on          date,
  priority        text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  owner           text not null,
  done_at         timestamptz,
  enquiry_id      uuid references crm_enquiries (id) on delete cascade,
  job_id          uuid references crm_jobs (id) on delete cascade,
  customer_id     uuid references customers (id) on delete cascade,
  created_at      timestamptz not null default now()
);

create table crm_activities (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  enquiry_id      uuid references crm_enquiries (id) on delete cascade,
  job_id          uuid references crm_jobs (id) on delete cascade,
  customer_id     uuid references customers (id) on delete cascade,
  kind            text not null default 'note' check (kind in ('note', 'call', 'email', 'meeting', 'stage', 'won')),
  body            text not null,
  actor           text not null,
  occurred_at     timestamptz not null default now()
);
create index crm_activities_enquiry_idx on crm_activities (enquiry_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Client files: taking a client on, and keeping them on. One file per client
-- company, from the won enquiry to the opened books and every review after:
-- the engagement letter as sent and as signed, the people behind the company,
-- the documents that prove who they are, their screening against the EU
-- sanctions list, and the risk assessment, scored as ICPAC's client
-- risk-based approach guidance sets out. Kept on the practice's own audit trail.
-- ---------------------------------------------------------------------------
create table client_files (
  id                    uuid primary key default gen_random_uuid(),
  practice_id           uuid not null references practices (id) on delete cascade,
  -- Set when the books are opened; an existing client's file has it from the start.
  organisation_id       uuid unique references organisations (id) on delete cascade,
  enquiry_id            uuid references crm_enquiries (id) on delete set null,
  status                text not null default 'onboarding' check (status in ('onboarding', 'active', 'declined')),
  company_name          text not null check (length(btrim(company_name)) between 1 and 200),
  -- Where the company is: its books are opened in that country's terms (lib/domain/regimes).
  country               char(2) not null default 'CY' check (country in ('CY', 'GB')),
  he_number             text,
  incorporated_on       date,
  registered_address    text,
  business              text not null default '',
  -- The kind of business (lib/domain/business-types), which shapes its Ledgerline when its books open. None: suggested from `business`.
  business_type         text check (business_type in ('trades', 'professional', 'agency', 'retail', 'wholesale', 'marine', 'property', 'health', 'holding', 'general')),
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  -- What the practice will do, and for how much. The engagement letter says the same.
  services              text[] not null default array['bookkeeping', 'vat', 'tax_return']
                          check (services <@ array['bookkeeping', 'vat', 'payroll', 'tax_return', 'annual_accounts', 'secretarial']),
  monthly_fee           numeric(12, 2) not null default 0 check (monthly_fee >= 0),
  hourly_rate           numeric(12, 2) not null default 0 check (hourly_rate >= 0),
  app_fee               numeric(12, 2) not null default 0 check (app_fee >= 0),
  -- How the books will be set up.
  vat_registered        boolean not null default true,
  vat_number            text,
  vat_quarter_end_month smallint not null default 3 check (vat_quarter_end_month between 1 and 3),
  year_end_month        smallint not null default 12 check (year_end_month between 1 and 12),
  books_from            date,
  manager               text,
  -- How the client came: met in person for identification, or not; introduced by someone else.
  face_to_face          boolean not null default true,
  introduced_by         text,
  -- The one link the client uses, with no login: the letter to sign and the documents to upload.
  client_token          text unique check (client_token ~ '^ll_cf_[A-Za-z0-9]{24}$'),
  letter_sent_at        timestamptz,
  letter_text           text,
  letter_hash           text check (letter_hash ~ '^[0-9a-f]{64}$'),
  signed_at             timestamptz,
  signed_name           text,
  signed_position       text,
  signed_ip             text,
  signed_agent          text,
  signed_hash           text check (signed_hash ~ '^[0-9a-f]{64}$'),
  opened_at             timestamptz,
  opened_by             text,
  -- A client the practice already had, brought over with its list: its engagement letter and due diligence were kept
  -- outside Ledgerline, and are added here as each comes up for review.
  imported_at           timestamptz,
  declined_reason       text,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  constraint client_files_signed check ((signed_at is null) = (signed_name is null) and (signed_at is null) = (signed_hash is null)),
  constraint client_files_active check (status <> 'active' or organisation_id is not null)
);

-- The people behind a client: its directors, secretary, shareholders, beneficial owners and anyone who signs for it.
create table client_people (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid not null references client_files (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 2 and 200),
  roles          text[] not null check (cardinality(roles) > 0 and roles <@ array['director', 'secretary', 'shareholder', 'beneficial_owner', 'signatory']),
  ownership      numeric(5, 2) check (ownership between 0 and 100),
  date_of_birth  date,
  nationality    char(2),
  residence      char(2),
  id_kind        text check (id_kind in ('passport', 'id_card')),
  id_number      text,
  id_expires     date,
  -- Politically exposed: the person, a family member of one, a known close associate, or no longer in office.
  pep            text not null default 'no' check (pep in ('no', 'pep', 'family', 'associate', 'former')),
  pep_detail     text,
  created_at     timestamptz not null default now()
);
create index client_people_file on client_people (file_id);

-- What the practice asked the client for, and what came back.
create table client_documents (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid not null references client_files (id) on delete cascade,
  person_id      uuid references client_people (id) on delete cascade,
  kind           text not null check (kind in ('incorporation', 'registered_office', 'officers', 'shareholders', 'identity', 'address', 'bank_statements', 'prior_accounts', 'other')),
  label          text not null,
  requested_at   timestamptz not null default now(),
  file_name      text,
  media_type     text check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  content        bytea,
  size_bytes     integer,
  received_at    timestamptz,
  received_from  text,
  constraint client_documents_received check ((received_at is null) = (content is null))
);
create index client_documents_file on client_documents (file_id);

-- The EU's consolidated list of persons, groups and entities subject to financial sanctions, as last fetched.
create table sanctions_lists (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'eu' check (source in ('eu')),
  generated_on  date not null,
  fetched_at    timestamptz not null default now(),
  entries       integer not null
);
create table sanctions_entries (
  list_id       uuid not null references sanctions_lists (id) on delete cascade,
  entity_id     text not null,
  kind          text not null check (kind in ('person', 'enterprise')),
  names         text[] not null,
  birth_dates   text[] not null default '{}',
  countries     text[] not null default '{}',
  programme     text,
  reference     text,
  designated_on date,
  url           text,
  primary key (list_id, entity_id)
);

-- Each screening of a name against the list: of a person, or (person_id null) of the company itself.
create table sanctions_screenings (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid not null references client_files (id) on delete cascade,
  person_id      uuid references client_people (id) on delete cascade,
  name           text not null,
  list_date      date not null,
  result         text not null check (result in ('clear', 'possible')),
  matches        jsonb not null default '[]'::jsonb,
  -- A possible match is closed by a person: not the same, with the reason; or confirmed, which stops the client being taken on.
  resolution     text check (resolution in ('not_the_same', 'confirmed')),
  resolved_note  text,
  resolved_by    text,
  resolved_at    timestamptz,
  screened_by    text not null,
  screened_at    timestamptz not null default now(),
  constraint sanctions_screenings_resolved check ((resolution is null) = (resolved_at is null) and (resolution is null or result = 'possible') and (resolution is null or length(btrim(coalesce(resolved_note, ''))) > 0))
);
create index sanctions_screenings_file on sanctions_screenings (file_id, screened_at desc);

-- The client risk assessment: four areas scored 1 to 5, summed to 4 to 20; 17 and over high, 9 to 16 normal, 8 and under low.
-- A politically exposed person, or a link to an EU high-risk third country, makes it high whatever the score.
create table risk_assessments (
  id               uuid primary key default gen_random_uuid(),
  file_id          uuid not null references client_files (id) on delete cascade,
  -- Each factor considered, as {area, label, score}: an area's score is the average of its factors, rounded up.
  factors          jsonb not null check (jsonb_typeof(factors) = 'array' and jsonb_array_length(factors) >= 4),
  client_score     smallint not null check (client_score between 1 and 5),
  service_score    smallint not null check (service_score between 1 and 5),
  geography_score  smallint not null check (geography_score between 1 and 5),
  channel_score    smallint not null check (channel_score between 1 and 5),
  total            smallint generated always as (client_score + service_score + geography_score + channel_score) stored,
  scored_level     text not null check (scored_level in ('low', 'normal', 'high')),
  forced_reason    text,
  level            text not null check (level in ('low', 'normal', 'high')),
  override_reason  text,
  notes            text,
  assessed_by      text not null,
  assessed_at      timestamptz not null default now(),
  approved_by      text,
  approved_as      text check (approved_as in ('mlco', 'partner')),
  approved_at      timestamptz,
  next_review_on   date,
  constraint risk_assessments_override check (level = scored_level or forced_reason is not null or length(btrim(coalesce(override_reason, ''))) > 0),
  constraint risk_assessments_forced check (forced_reason is null or level = 'high'),
  constraint risk_assessments_approved check ((approved_at is null) = (approved_by is null) and (approved_at is null) = (next_review_on is null))
);
create index risk_assessments_file on risk_assessments (file_id, assessed_at desc);

-- A client file's events go on the practice's own audit trail.
create function practice_org(p_practice uuid) returns uuid language sql stable as $$ select id from organisations where practice_id = p_practice and is_practice $$;
create function audit_client_file() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform audit_append(practice_org(new.practice_id), 'opened', 'client_file', new.id, jsonb_build_object('company', new.company_name, 'status', new.status));
  else
    if new.letter_sent_at is distinct from old.letter_sent_at and new.letter_sent_at is not null then
      perform audit_append(practice_org(new.practice_id), 'sent', 'engagement_letter', new.id, jsonb_build_object('company', new.company_name, 'hash', new.letter_hash));
    end if;
    if new.signed_at is distinct from old.signed_at and new.signed_at is not null then
      perform audit_append(practice_org(new.practice_id), 'signed', 'engagement_letter', new.id, jsonb_build_object('company', new.company_name, 'by', new.signed_name, 'hash', new.signed_hash, 'ip', new.signed_ip));
    end if;
    if new.status is distinct from old.status then
      perform audit_append(practice_org(new.practice_id), new.status, 'client_file', new.id, jsonb_build_object('company', new.company_name, 'reason', new.declined_reason));
    end if;
  end if;
  return new;
end $$;
create trigger client_files_audit after insert or update on client_files for each row execute function audit_client_file();

create function audit_client_check() returns trigger language plpgsql as $$
declare v_file client_files;
begin
  select * into v_file from client_files where id = new.file_id;
  if tg_table_name = 'sanctions_screenings' then
    if tg_op = 'INSERT' then
      perform audit_append(practice_org(v_file.practice_id), 'screened', 'sanctions', new.id, jsonb_build_object('company', v_file.company_name, 'name', new.name, 'result', new.result, 'list', new.list_date, 'matches', jsonb_array_length(new.matches)));
    elsif new.resolution is distinct from old.resolution then
      perform audit_append(practice_org(v_file.practice_id), 'resolved', 'sanctions', new.id, jsonb_build_object('company', v_file.company_name, 'name', new.name, 'resolution', new.resolution, 'note', new.resolved_note));
    end if;
  else
    if tg_op = 'INSERT' then
      perform audit_append(practice_org(v_file.practice_id), 'assessed', 'risk', new.id, jsonb_build_object('company', v_file.company_name, 'total', new.total, 'level', new.level, 'forced', new.forced_reason, 'override', new.override_reason));
    elsif new.approved_at is distinct from old.approved_at and new.approved_at is not null then
      perform audit_append(practice_org(v_file.practice_id), 'approved', 'risk', new.id, jsonb_build_object('company', v_file.company_name, 'level', new.level, 'as', new.approved_as, 'next_review', new.next_review_on));
    end if;
  end if;
  return new;
end $$;
create trigger sanctions_screenings_audit after insert or update on sanctions_screenings for each row execute function audit_client_check();

-- A document received for due diligence, with the fingerprint of the file as it arrived.
create function audit_client_document() returns trigger language plpgsql as $$
declare v_file client_files;
begin
  if new.received_at is not null and old.received_at is null then
    select * into v_file from client_files where id = new.file_id;
    perform audit_append(practice_org(v_file.practice_id), 'received', 'client_document', new.id, jsonb_build_object('company', v_file.company_name, 'document', new.label,
      'file', new.file_name, 'from', new.received_from, 'sha256', encode(sha256(new.content), 'hex')));
  end if;
  return new;
end $$;
create trigger client_documents_audit after update on client_documents for each row execute function audit_client_document();

-- Who was asked to join, who joined, and whose invitation was withdrawn: on the practice's trail.
create function audit_invitation() returns trigger language plpgsql as $$
declare v_action text := case when tg_op = 'INSERT' then 'invited' when new.accepted_at is not null and old.accepted_at is null then 'accepted'
  when new.revoked_at is not null and old.revoked_at is null then 'revoked' end;
begin
  if v_action is not null then
    perform audit_append(practice_org(new.practice_id), v_action, 'invitation', new.id, jsonb_build_object('email', new.email, 'name', new.name, 'role', new.role,
      'company', (select name from organisations where id = new.organisation_id)));
  end if;
  return new;
end $$;
create trigger invitations_audit after insert or update on invitations for each row execute function audit_invitation();
-- A document shared with its customer, the link stopped, a quote accepted from it. Its opening is counted, not chained.
create function audit_document_link() returns trigger language plpgsql as $$
declare v_action text := case when tg_op = 'INSERT' then 'shared' when new.revoked_at is not null and old.revoked_at is null then 'stopped'
  when new.accepted_at is not null and old.accepted_at is null then 'accepted' end;
begin
  if v_action is not null then
    perform audit_append(new.organisation_id, v_action, 'document_link', new.id, jsonb_build_object(
      'document', coalesce((select 'Invoice ' || number from invoices where id = new.invoice_id), (select 'Quote ' || number from quotes where id = new.quote_id)),
      'name', new.accepted_name));
  end if;
  return new;
end $$;
create trigger document_links_audit after insert or update on document_links for each row execute function audit_document_link();
create trigger risk_assessments_audit after insert or update on risk_assessments for each row execute function audit_client_check();

-- ---------------------------------------------------------------------------
-- Each financial year's close: whether it is audited or reviewed, the figures
-- that decide it which aren't in the books, and the date each step was done.
-- The rules are in src/lib/domain/audit.ts (Cap. 113, ss.120, 125, 141A, 142, 152A).
-- ---------------------------------------------------------------------------
create table year_ends (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references organisations (id) on delete cascade,
  period_end           date not null,
  -- A UK company small enough is exempt from audit.
  assurance            text not null default 'audit' check (assurance in ('audit', 'review', 'exempt')),
  framework            text not null default 'ifrs' check (framework in ('ifrs', 'frs_small')),
  -- Not in the books: the average number of employees, the year's turnover before Ledgerline kept the books,
  -- and the year before's figures when that year isn't in Ledgerline at all.
  average_employees    numeric(7, 1) check (average_employees >= 0),
  turnover_before_books numeric(14, 2) check (turnover_before_books >= 0),
  prior_turnover       numeric(14, 2) check (prior_turnover >= 0),
  prior_total_assets   numeric(14, 2) check (prior_total_assets >= 0),
  sent_to_auditor_on   date,
  report_signed_on     date,
  opinion              text check (opinion in ('unmodified', 'qualified', 'adverse', 'disclaimer')),
  approved_on          date,
  agm_on               date,
  filed_on             date,
  tax_return_filed_on  date,
  notes                text,
  updated_by           text,
  updated_at           timestamptz not null default now(),
  unique (organisation_id, period_end),
  constraint year_ends_opinion check ((opinion is null) = (report_signed_on is null))
);

-- ---------------------------------------------------------------------------
-- Payroll (Cyprus): the employees, each month's run and its payslips. A run is worked out in lib/domain/payroll-cy
-- and, once approved, posts one entry: wages and the employer's contributions against what is owed to Social
-- Insurance Services, the tax withheld and the net salaries.
-- ---------------------------------------------------------------------------

create table employees (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 200),
  email               text,
  job_title           text,
  -- What the monthly TD7 and Social Insurance Services need: the tax identification and social insurance numbers.
  tic                 text,
  social_insurance_no text,
  id_document         text,
  date_of_birth       date,
  start_date          date not null,
  leave_date          date,
  monthly_salary      numeric(12, 2) not null check (monthly_salary >= 0),
  thirteenth_salary   boolean not null default true,
  iban                text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  -- Declared on form TD59 for the tax year: deductions (children, home interest or rent, insurance), and any exempt part of the pay.
  annual_deductions   numeric(12, 2) not null default 0 check (annual_deductions >= 0),
  annual_exemption    numeric(12, 2) not null default 0 check (annual_exemption >= 0),
  -- The year's pay before Ledgerline ran the payroll: brought forward for the tax to be right from the first run.
  ytd_year            smallint,
  ytd_gross           numeric(12, 2) not null default 0,
  ytd_insurable       numeric(12, 2) not null default 0,
  ytd_si              numeric(12, 2) not null default 0,
  ytd_gesy            numeric(12, 2) not null default 0,
  ytd_tax             numeric(12, 2) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, id),
  constraint employees_dates check (leave_date is null or leave_date >= start_date)
);

create table payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  period          date not null check (extract(day from period) = 1),
  pay_date        date not null,
  status          text not null default 'draft' check (status in ('draft', 'posted')),
  posted_at       timestamptz,
  posted_by       text,
  created_by      text,
  created_at      timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, period)
);

create table payslips (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  run_id          uuid not null,
  employee_id     uuid not null,
  salary          numeric(12, 2) not null default 0,
  other_pay       numeric(12, 2) not null default 0,
  thirteenth      numeric(12, 2) not null default 0,
  gross           numeric(12, 2) not null,
  insurable       numeric(12, 2) not null,
  si_employee     numeric(12, 2) not null,
  gesy_employee   numeric(12, 2) not null,
  paye            numeric(12, 2) not null,
  net             numeric(12, 2) not null,
  si_employer     numeric(12, 2) not null,
  gesy_employer   numeric(12, 2) not null,
  social_cohesion numeric(12, 2) not null,
  redundancy      numeric(12, 2) not null,
  training        numeric(12, 2) not null,
  unique (run_id, employee_id),
  foreign key (organisation_id, run_id) references payroll_runs (organisation_id, id) on delete cascade,
  foreign key (organisation_id, employee_id) references employees (organisation_id, id),
  constraint payslips_net check (net = gross - si_employee - gesy_employee - paye)
);

-- A run once approved: one entry on its pay date. The accounts it needs are made if the company's chart lacks them.
create function post_payroll_run(p_id uuid) returns void language plpgsql as $$
declare v payroll_runs; t record; v_wages uuid; v_costs uuid; v_social uuid; v_paye uuid; v_net uuid;
  v_label text;
begin
  select * into v from payroll_runs where id = p_id;
  if not found then
    perform ledger_replace(e.organisation_id, 'payroll', p_id, null, null, null, null) from journal_entries e where e.source = 'payroll' and e.source_id = p_id;
    return;
  end if;
  if v.status <> 'posted' then perform ledger_replace(v.organisation_id, 'payroll', p_id, null, null, null, null); return; end if;
  insert into ledger_accounts (organisation_id, code, name, type, outside_vat)
  select v.organisation_id, a.code, a.name, a.type::ledger_account_type, true
    from (values ('477', 'Salaries and wages', 'expense'), ('478', 'Social insurance, GESY and employer funds', 'expense'), ('825', 'Social insurance and GESY payable', 'current_liability'),
                 ('826', 'Income tax withheld (PAYE) payable', 'current_liability'), ('835', 'Net salaries payable', 'current_liability')) a (code, name, type)
   where not exists (select 1 from ledger_accounts l where l.organisation_id = v.organisation_id and l.code = a.code);
  select id into v_wages from ledger_accounts where organisation_id = v.organisation_id and code = '477';
  select id into v_costs from ledger_accounts where organisation_id = v.organisation_id and code = '478';
  select id into v_social from ledger_accounts where organisation_id = v.organisation_id and code = '825';
  select id into v_paye from ledger_accounts where organisation_id = v.organisation_id and code = '826';
  select id into v_net from ledger_accounts where organisation_id = v.organisation_id and code = '835';
  select coalesce(sum(gross), 0) as gross, coalesce(sum(si_employee + gesy_employee), 0) as deducted, coalesce(sum(paye), 0) as paye, coalesce(sum(net), 0) as net,
         coalesce(sum(si_employer + gesy_employer + social_cohesion + redundancy + training), 0) as employer
    into t from payslips where run_id = p_id;
  v_label := to_char(v.period, 'FMMonth YYYY');
  perform ledger_replace(v.organisation_id, 'payroll', p_id, v.pay_date, 'PAY ' || to_char(v.period, 'YYYY-MM'), 'Payroll, ' || v_label, jsonb_build_array(
    jsonb_build_object('account_id', v_wages, 'debit', t.gross, 'description', 'Gross pay, ' || v_label),
    jsonb_build_object('account_id', v_costs, 'debit', t.employer, 'description', 'Employer''s social insurance, GESY and funds'),
    jsonb_build_object('account_id', v_social, 'credit', t.deducted + t.employer, 'description', 'To Social Insurance Services'),
    jsonb_build_object('account_id', v_paye, 'credit', t.paye, 'description', 'Income tax withheld, to the Tax Department'),
    jsonb_build_object('account_id', v_net, 'credit', t.net, 'description', 'Net salaries to pay')));
end $$;

-- A calendar someone subscribes to from Google, Outlook or Apple: a secret link, kept only as its hash.
-- It shows what its person may see (every client, or one company), and stops when they make a new one.
create table calendar_feeds (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_users (id) on delete cascade,
  organisation_id uuid references organisations (id) on delete cascade,
  -- What it shows: one kind (deadlines, tasks, invoices due, quotes expiring), or everything.
  kind            text check (kind in ('deadline', 'task', 'invoice', 'quote')),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
create unique index calendar_feeds_one_live on calendar_feeds (user_id, coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Who may see what. Every request from a signed-in person runs as the role
-- `authenticated`, with their id in request.jwt.claims, as Supabase sets it;
-- row-level security then decides each row. A practice's people see every
-- company the practice keeps; a client company's own people see that company
-- and nothing else, and none of the practice's records about it: its AML
-- file, its fee, the time spent on it. Work no person does (a client signing
-- through their link, the website form, the seed, a nightly job) runs as the
-- database's owner, and the code says so where it does.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

-- The practices the person works at.
create function my_practices() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(practice_id), '{}') from practice_staff where user_id = app_user_id()
$$;
-- Every company those practices keep the books for, and the practice's own books.
create function practice_companies() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(o.id), '{}') from organisations o join practice_staff s on s.practice_id = o.practice_id where s.user_id = app_user_id()
$$;
-- What the person may see: their practices' companies, and any company they are a member of.
create function visible_companies() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select o.id from organisations o join practice_staff s on s.practice_id = o.practice_id where s.user_id = app_user_id()
    union all select organisation_id from company_members where user_id = app_user_id()) visible
$$;
-- What the person may change: their practices' companies, and the companies where they are an owner or staff.
-- A viewer, and a company's auditor, read only.
create function writable_companies() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select o.id from organisations o join practice_staff s on s.practice_id = o.practice_id where s.user_id = app_user_id()
    union all select organisation_id from company_members where user_id = app_user_id() and role in ('owner', 'staff')) writable
$$;
-- What the person may set up (how a company works: its names, stages and fields): their practices' companies, and those they own.
create function setup_companies() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select o.id from organisations o join practice_staff s on s.practice_id = o.practice_id where s.user_id = app_user_id()
    union all select organisation_id from company_members where user_id = app_user_id() and role = 'owner') setup
$$;
-- Whose payroll the person sees: their practices' companies, and those they own or audit. A company's other people see the
-- wages in its books as totals, never what each person is paid.
create function payroll_companies() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select o.id from organisations o join practice_staff s on s.practice_id = o.practice_id where s.user_id = app_user_id()
    union all select organisation_id from company_members where user_id = app_user_id() and role in ('owner', 'auditor')) payroll
$$;
-- The client companies the person owns: they may invite that company's own people.
create function owned_companies() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(organisation_id), '{}') from company_members where user_id = app_user_id() and role = 'owner'
$$;
-- The people the person may see: themselves, their colleagues, and the members of their practices' companies.
create function visible_users() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select app_user_id() as id
    union all select s.user_id from practice_staff s where s.practice_id = any (my_practices()) and s.user_id is not null
    union all select m.user_id from company_members m where m.organisation_id = any (practice_companies())
    union all select m.user_id from company_members m join company_members mine on mine.organisation_id = m.organisation_id where mine.user_id = app_user_id()) visible where id is not null
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Written only by the database itself (the audit chain) or by Ledgerline's own jobs (the sanctions list, the demo VIES register).
revoke insert, update, delete on audit_log, sanctions_lists, sanctions_entries, vies_demo_register from authenticated;

alter table app_users enable row level security;
alter table audit_log enable row level security;
alter table bank_line_matches enable row level security;
alter table bank_statement_imports enable row level security;
alter table bank_statement_lines enable row level security;
alter table bank_transaction_lines enable row level security;
alter table bank_transactions enable row level security;
alter table bill_lines enable row level security;
alter table bill_payment_runs enable row level security;
alter table bill_payments enable row level security;
alter table bills enable row level security;
alter table capture_files enable row level security;
alter table capture_items enable row level security;
alter table client_documents enable row level security;
alter table client_fees enable row level security;
alter table client_files enable row level security;
alter table client_people enable row level security;
alter table company_members enable row level security;
alter table credit_allocations enable row level security;
alter table credit_note_lines enable row level security;
alter table credit_notes enable row level security;
alter table crm_activities enable row level security;
alter table crm_contacts enable row level security;
alter table crm_enquiries enable row level security;
alter table crm_jobs enable row level security;
alter table crm_stages enable row level security;
alter table custom_fields enable row level security;
alter table workspace_settings enable row level security;
alter table crm_tasks enable row level security;
alter table customers enable row level security;
alter table deadline_marks enable row level security;
alter table enquiry_form_keys enable row level security;
alter table fee_invoices enable row level security;
alter table year_ends enable row level security;
alter table calendar_feeds enable row level security;
alter table employees enable row level security;
alter table payroll_runs enable row level security;
alter table payslips enable row level security;
alter table invitations enable row level security;
alter table user_dismissals enable row level security;
alter table document_links enable row level security;
alter table invoice_lines enable row level security;
alter table invoice_payments enable row level security;
alter table invoices enable row level security;
alter table items enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table ledger_accounts enable row level security;
alter table organisation_logos enable row level security;
alter table organisations enable row level security;
alter table practice_staff enable row level security;
alter table practices enable row level security;
alter table quote_lines enable row level security;
alter table quotes enable row level security;
alter table repeating_invoices enable row level security;
alter table risk_assessments enable row level security;
alter table sanctions_entries enable row level security;
alter table sanctions_lists enable row level security;
alter table sanctions_screenings enable row level security;
alter table supplier_credit_allocations enable row level security;
alter table supplier_credit_lines enable row level security;
alter table supplier_credits enable row level security;
alter table suppliers enable row level security;
alter table time_entries enable row level security;
alter table vat_checks enable row level security;
alter table vat_returns enable row level security;
alter table vies_demo_register enable row level security;

-- A company's books: read by everyone who may see the company, changed by those who may change it.
-- An update reaches every row its asker can see and is checked against what they may change, so someone
-- who may only read (a viewer, the auditor) is refused out loud rather than finding nothing changed.
create policy bank_line_matches_read on bank_line_matches for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bank_line_matches_insert on bank_line_matches for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_line_matches_update on bank_line_matches for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_line_matches_delete on bank_line_matches for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_statement_imports_read on bank_statement_imports for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bank_statement_imports_insert on bank_statement_imports for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_statement_imports_update on bank_statement_imports for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_statement_imports_delete on bank_statement_imports for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_statement_lines_read on bank_statement_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bank_statement_lines_insert on bank_statement_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_statement_lines_update on bank_statement_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_statement_lines_delete on bank_statement_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_transaction_lines_read on bank_transaction_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bank_transaction_lines_insert on bank_transaction_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_transaction_lines_update on bank_transaction_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_transaction_lines_delete on bank_transaction_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_transactions_read on bank_transactions for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bank_transactions_insert on bank_transactions for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_transactions_update on bank_transactions for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bank_transactions_delete on bank_transactions for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_lines_read on bill_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bill_lines_insert on bill_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_lines_update on bill_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_lines_delete on bill_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_payment_runs_read on bill_payment_runs for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bill_payment_runs_insert on bill_payment_runs for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_payment_runs_update on bill_payment_runs for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_payment_runs_delete on bill_payment_runs for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_payments_read on bill_payments for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bill_payments_insert on bill_payments for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_payments_update on bill_payments for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bill_payments_delete on bill_payments for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy bills_read on bills for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy bills_insert on bills for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bills_update on bills for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy bills_delete on bills for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_allocations_read on credit_allocations for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy credit_allocations_insert on credit_allocations for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_allocations_update on credit_allocations for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_allocations_delete on credit_allocations for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_note_lines_read on credit_note_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy credit_note_lines_insert on credit_note_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_note_lines_update on credit_note_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_note_lines_delete on credit_note_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_notes_read on credit_notes for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy credit_notes_insert on credit_notes for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_notes_update on credit_notes for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy credit_notes_delete on credit_notes for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_activities_read on crm_activities for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy crm_activities_insert on crm_activities for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_activities_update on crm_activities for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_activities_delete on crm_activities for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_contacts_read on crm_contacts for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy crm_contacts_insert on crm_contacts for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_contacts_update on crm_contacts for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_contacts_delete on crm_contacts for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_enquiries_read on crm_enquiries for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy crm_enquiries_insert on crm_enquiries for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_enquiries_update on crm_enquiries for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_enquiries_delete on crm_enquiries for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_jobs_read on crm_jobs for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy crm_jobs_insert on crm_jobs for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_jobs_update on crm_jobs for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_jobs_delete on crm_jobs for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
-- How a company works is read by everyone in it and set by its accountant or its owner.
create policy crm_stages_read on crm_stages for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy crm_stages_insert on crm_stages for insert to authenticated with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy crm_stages_update on crm_stages for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy crm_stages_delete on crm_stages for delete to authenticated using (organisation_id = any ((select setup_companies())::uuid[]));
create policy custom_fields_read on custom_fields for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy custom_fields_insert on custom_fields for insert to authenticated with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy custom_fields_update on custom_fields for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy custom_fields_delete on custom_fields for delete to authenticated using (organisation_id = any ((select setup_companies())::uuid[]));
create policy workspace_settings_read on workspace_settings for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy workspace_settings_insert on workspace_settings for insert to authenticated with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy workspace_settings_update on workspace_settings for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy workspace_settings_delete on workspace_settings for delete to authenticated using (organisation_id = any ((select setup_companies())::uuid[]));
create policy crm_tasks_read on crm_tasks for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy crm_tasks_insert on crm_tasks for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_tasks_update on crm_tasks for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy crm_tasks_delete on crm_tasks for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy customers_read on customers for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy customers_insert on customers for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy customers_update on customers for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy customers_delete on customers for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy deadline_marks_read on deadline_marks for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy deadline_marks_insert on deadline_marks for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy deadline_marks_update on deadline_marks for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy deadline_marks_delete on deadline_marks for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy enquiry_form_keys_read on enquiry_form_keys for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy enquiry_form_keys_insert on enquiry_form_keys for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy enquiry_form_keys_update on enquiry_form_keys for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy enquiry_form_keys_delete on enquiry_form_keys for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoice_lines_read on invoice_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy invoice_lines_insert on invoice_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoice_lines_update on invoice_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoice_lines_delete on invoice_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoice_payments_read on invoice_payments for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy invoice_payments_insert on invoice_payments for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoice_payments_update on invoice_payments for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoice_payments_delete on invoice_payments for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoices_read on invoices for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy invoices_insert on invoices for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoices_update on invoices for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy invoices_delete on invoices for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy items_read on items for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy items_insert on items for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy items_update on items for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy items_delete on items for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy journal_entries_read on journal_entries for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy journal_entries_insert on journal_entries for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy journal_entries_update on journal_entries for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy journal_entries_delete on journal_entries for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy journal_lines_read on journal_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy journal_lines_insert on journal_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy journal_lines_update on journal_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy journal_lines_delete on journal_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy ledger_accounts_read on ledger_accounts for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy ledger_accounts_insert on ledger_accounts for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy ledger_accounts_update on ledger_accounts for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy ledger_accounts_delete on ledger_accounts for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy organisation_logos_read on organisation_logos for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy organisation_logos_insert on organisation_logos for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy organisation_logos_update on organisation_logos for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy organisation_logos_delete on organisation_logos for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy quote_lines_read on quote_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy quote_lines_insert on quote_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy quote_lines_update on quote_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy quote_lines_delete on quote_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy quotes_read on quotes for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy quotes_insert on quotes for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy quotes_update on quotes for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy quotes_delete on quotes for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy repeating_invoices_read on repeating_invoices for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy repeating_invoices_insert on repeating_invoices for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy repeating_invoices_update on repeating_invoices for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy repeating_invoices_delete on repeating_invoices for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credit_allocations_read on supplier_credit_allocations for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy supplier_credit_allocations_insert on supplier_credit_allocations for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credit_allocations_update on supplier_credit_allocations for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credit_allocations_delete on supplier_credit_allocations for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credit_lines_read on supplier_credit_lines for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy supplier_credit_lines_insert on supplier_credit_lines for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credit_lines_update on supplier_credit_lines for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credit_lines_delete on supplier_credit_lines for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credits_read on supplier_credits for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy supplier_credits_insert on supplier_credits for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credits_update on supplier_credits for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy supplier_credits_delete on supplier_credits for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy suppliers_read on suppliers for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy suppliers_insert on suppliers for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy suppliers_update on suppliers for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy suppliers_delete on suppliers for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy vat_checks_read on vat_checks for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy vat_checks_insert on vat_checks for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy vat_checks_update on vat_checks for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy vat_checks_delete on vat_checks for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
create policy vat_returns_read on vat_returns for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy vat_returns_insert on vat_returns for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy vat_returns_update on vat_returns for update to authenticated using (organisation_id = any ((select visible_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy vat_returns_delete on vat_returns for delete to authenticated using (organisation_id = any ((select writable_companies())::uuid[]));
-- The practice's own records about a company: its people only.
create policy client_fees_access on client_fees for all to authenticated using (organisation_id = any ((select practice_companies())::uuid[])) with check (organisation_id = any ((select practice_companies())::uuid[]));
create policy time_entries_access on time_entries for all to authenticated using (organisation_id = any ((select practice_companies())::uuid[])) with check (organisation_id = any ((select practice_companies())::uuid[]));
-- A year end: seen by everyone who may see the company (its auditor included); kept by the practice.
create policy year_ends_read on year_ends for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy year_ends_write on year_ends for all to authenticated using (organisation_id = any ((select practice_companies())::uuid[])) with check (organisation_id = any ((select practice_companies())::uuid[]));
-- A company's payroll: read by those who may see its books, changed by those who may change them.
create policy employees_read on employees for select to authenticated using (organisation_id = any ((select payroll_companies())::uuid[]));
create policy employees_insert on employees for insert to authenticated with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy employees_update on employees for update to authenticated using (organisation_id = any ((select payroll_companies())::uuid[])) with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy employees_delete on employees for delete to authenticated using (organisation_id = any ((select setup_companies())::uuid[]));
create policy payroll_runs_read on payroll_runs for select to authenticated using (organisation_id = any ((select payroll_companies())::uuid[]));
create policy payroll_runs_insert on payroll_runs for insert to authenticated with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy payroll_runs_update on payroll_runs for update to authenticated using (organisation_id = any ((select payroll_companies())::uuid[])) with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy payroll_runs_delete on payroll_runs for delete to authenticated using (organisation_id = any ((select setup_companies())::uuid[]));
create policy payslips_read on payslips for select to authenticated using (organisation_id = any ((select payroll_companies())::uuid[]));
create policy payslips_insert on payslips for insert to authenticated with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy payslips_update on payslips for update to authenticated using (organisation_id = any ((select payroll_companies())::uuid[])) with check (organisation_id = any ((select setup_companies())::uuid[]));
create policy payslips_delete on payslips for delete to authenticated using (organisation_id = any ((select setup_companies())::uuid[]));
-- Each person's own calendar links, for companies they can see. Reading a link's calendar goes through the service, by its hash.
create policy calendar_feeds_own on calendar_feeds for all to authenticated using (user_id = (select app_user_id()))
  with check (user_id = (select app_user_id()) and (organisation_id is null or organisation_id = any ((select visible_companies())::uuid[])));
create policy fee_invoices_access on fee_invoices for all to authenticated using (client_organisation_id = any ((select practice_companies())::uuid[])) with check (client_organisation_id = any ((select practice_companies())::uuid[]));

-- The audit trail: read by everyone who may see the company; written only by audit_append.
create policy audit_log_read on audit_log for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));

-- Companies: seen by whoever may see them; created by the practice (opening the books), never deleted from here.
create policy organisations_read on organisations for select to authenticated using (id = any ((select visible_companies())::uuid[]));
create policy organisations_update on organisations for update to authenticated using (id = any ((select visible_companies())::uuid[])) with check (id = any ((select writable_companies())::uuid[]));
create policy organisations_insert on organisations for insert to authenticated with check (practice_id = any ((select my_practices())::uuid[]));

-- The practice: its people manage it; a client company's people see whose practice it is (its name and colours).
create policy practices_read on practices for select to authenticated
  using (id = any ((select my_practices())::uuid[]) or id in (select practice_id from organisations where id = any ((select visible_companies())::uuid[])));
create policy practices_update on practices for update to authenticated using (id = any ((select my_practices())::uuid[])) with check (id = any ((select my_practices())::uuid[]));
create policy practice_staff_access on practice_staff for all to authenticated using (practice_id = any ((select my_practices())::uuid[])) with check (practice_id = any ((select my_practices())::uuid[]));
create policy company_members_access on company_members for all to authenticated
  using (organisation_id = any ((select practice_companies())::uuid[]) or organisation_id = any ((select owned_companies())::uuid[]) or user_id = app_user_id())
  with check (organisation_id = any ((select practice_companies())::uuid[]) or organisation_id = any ((select owned_companies())::uuid[]));
create policy app_users_read on app_users for select to authenticated using (id = any ((select visible_users())::uuid[]));
-- Invitations: the practice's people manage them, and a client company's owner those to that company. Someone joining
-- reaches theirs only through its link, which Ledgerline checks itself.
create policy invitations_access on invitations for all to authenticated
  using (practice_id = any ((select my_practices())::uuid[]) or organisation_id = any ((select owned_companies())::uuid[]))
  with check (practice_id = any ((select my_practices())::uuid[]) or organisation_id = any ((select owned_companies())::uuid[]));
create policy app_users_update on app_users for update to authenticated using (id = app_user_id()) with check (id = app_user_id());
-- A document's link for its customer: seen by whoever sees the company, made and stopped by whoever keeps its books. Opening it is Ledgerline's own business.
create policy document_links_read on document_links for select to authenticated using (organisation_id = any ((select visible_companies())::uuid[]));
create policy document_links_insert on document_links for insert to authenticated with check (organisation_id = any ((select writable_companies())::uuid[]));
create policy document_links_update on document_links for update to authenticated
  using (organisation_id = any ((select writable_companies())::uuid[])) with check (organisation_id = any ((select writable_companies())::uuid[]));
-- What someone has put away is theirs alone, at a company they can see.
create policy user_dismissals_own on user_dismissals for all to authenticated
  using (user_id = app_user_id()) with check (user_id = app_user_id() and organisation_id = any ((select visible_companies())::uuid[]));

-- Client files, and everything in them: the practice's people only. A client never sees its own AML file.
create policy client_files_access on client_files for all to authenticated using (practice_id = any ((select my_practices())::uuid[])) with check (practice_id = any ((select my_practices())::uuid[]));
create policy client_people_access on client_people for all to authenticated using (exists (select 1 from client_files f where f.id = file_id)) with check (exists (select 1 from client_files f where f.id = file_id));
create policy client_documents_access on client_documents for all to authenticated using (exists (select 1 from client_files f where f.id = file_id)) with check (exists (select 1 from client_files f where f.id = file_id));
create policy risk_assessments_access on risk_assessments for all to authenticated using (exists (select 1 from client_files f where f.id = file_id)) with check (exists (select 1 from client_files f where f.id = file_id));
create policy sanctions_screenings_access on sanctions_screenings for all to authenticated using (exists (select 1 from client_files f where f.id = file_id)) with check (exists (select 1 from client_files f where f.id = file_id));

-- Captured documents: the practice's inbox, and a company's own uploads.
create policy capture_files_read on capture_files for select to authenticated
  using (practice_id = any ((select my_practices())::uuid[]) or organisation_id = any ((select visible_companies())::uuid[]));
create policy capture_files_write on capture_files for all to authenticated
  using (practice_id = any ((select my_practices())::uuid[]) or organisation_id = any ((select writable_companies())::uuid[]))
  with check (practice_id = any ((select my_practices())::uuid[]) or organisation_id = any ((select writable_companies())::uuid[]));
create policy capture_items_read on capture_items for select to authenticated using (exists (select 1 from capture_files f where f.id = file_id));
create policy capture_items_write on capture_items for all to authenticated
  using (exists (select 1 from capture_files f where f.id = file_id and (f.practice_id = any ((select my_practices())::uuid[]) or f.organisation_id = any ((select writable_companies())::uuid[]))))
  with check (exists (select 1 from capture_files f where f.id = file_id and (f.practice_id = any ((select my_practices())::uuid[]) or f.organisation_id = any ((select writable_companies())::uuid[]))));

-- Reference data everyone signed in may read.
create policy sanctions_lists_read on sanctions_lists for select to authenticated using (true);
create policy sanctions_entries_read on sanctions_entries for select to authenticated using (true);
create policy vies_demo_register_read on vies_demo_register for select to authenticated using (true);

-- Views read with the rights of the person asking, so the rules above hold through them too.
alter view v_bank_statement_lines set (security_invoker = true);
alter view v_bank_lines_unmatched set (security_invoker = true);
alter view v_bank_transaction_directory set (security_invoker = true);
alter view v_bill_directory set (security_invoker = true);
alter view v_credit_note_directory set (security_invoker = true);
alter view v_invoice_directory set (security_invoker = true);
alter view v_journal_lines set (security_invoker = true);
alter view v_quote_directory set (security_invoker = true);
alter view v_supplier_credit_directory set (security_invoker = true);
