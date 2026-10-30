-- 30 Oct 2026: entries join the audit trail one at a time. It is one chain for every company, each entry linked to the
-- one before it: two transactions appending at once (two people saving at the same moment, anywhere) could both link to
-- the same entry, and audit_verify() would then find the chain broken. An append now waits for the one before it to be
-- committed, and keeps its turn until its own transaction ends, as its entry does; its time is when it joined.
create or replace function audit_append(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text; v_at timestamptz;
  v_actor text := coalesce(nullif(current_setting('ledgerline.actor', true), ''), (select name from app_users where id = app_user_id()), 'system');
begin
  if coalesce(current_setting('ledgerline.seeding', true), '') = 'on' then return; end if;
  perform pg_advisory_xact_lock(hashtext('ledgerline.audit_log'));
  v_at := clock_timestamp();
  select hash into v_prev from audit_log order by seq desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into audit_log (at, organisation_id, actor, action, entity, entity_id, detail, prev_hash, hash)
  values (v_at, p_org, v_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb), v_prev,
          audit_hash(v_prev, v_at, p_org, v_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb)));
end $$;
