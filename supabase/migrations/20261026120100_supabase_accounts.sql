-- Supabase only (the laptop demo has no auth schema). Ties Supabase Auth to
-- Ledgerline: each person who signs up gets their Ledgerline user, with the
-- same id, so request.jwt.claims' sub is app_users.id; and the anonymous
-- role is given nothing at all.

create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1));
begin
  insert into public.app_users (id, name, email, initials)
  values (new.id, v_name, new.email, upper(left(coalesce((select string_agg(left(word, 1), '') from unnest(string_to_array(v_name, ' ')) word where word <> ''), v_name), 3)))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create function public.handle_auth_email_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users for each row when (old.email is distinct from new.email) execute function public.handle_auth_email_change();

-- Ledgerline reads and writes through its server only. The public Data API gets nothing without a signed-in person,
-- and row-level security (in the baseline) governs a signed-in one.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- The server connects as postgres and takes the role of the signed-in person for each request.
do $$ begin
  if not pg_has_role(current_user, 'authenticated', 'member') then execute format('grant authenticated to %I', current_user); end if;
end $$;
