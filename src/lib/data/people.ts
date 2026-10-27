import "server-only";

import { sql } from "@/lib/db";

/** Who uses Ledgerline: the practice's people, and a client company's own, with the invitations waiting. */

export type Invitation = { id: string; email: string; name: string; role: string; mlco: boolean; created_at: string; expires_at: string; invited_by_name: string | null; expired: boolean };

const INVITATION_COLUMNS = `i.id, i.email, i.name, i.role, i.mlco, i.created_at, i.expires_at, u.name as invited_by_name, i.expires_at < now() as expired`;

export async function getPracticePeople(practiceId: string) {
  const [staff, invitations] = await Promise.all([
    sql<{ id: string; name: string; role: string | null; mlco: boolean; weekly_hours: number; user_id: string | null; email: string | null; has_sign_in: boolean }>(`
      select s.id, s.name, s.role, s.mlco, s.weekly_hours, s.user_id, u.email, u.auth_id is not null as has_sign_in from practice_staff s left join app_users u on u.id = s.user_id
       where s.practice_id = $1 order by (s.role = 'Partner') desc, s.name`, [practiceId]),
    sql<Invitation>(`select ${INVITATION_COLUMNS} from invitations i left join app_users u on u.id = i.invited_by
      where i.practice_id = $1 and i.organisation_id is null and i.accepted_at is null and i.revoked_at is null order by i.created_at desc`, [practiceId]),
  ]);
  return { staff, invitations };
}

export async function getCompanyPeople(organisationId: string) {
  const [members, invitations] = await Promise.all([
    sql<{ user_id: string; name: string; email: string; role: string; created_at: string; has_sign_in: boolean }>(`
      select m.user_id, u.name, u.email, m.role, m.created_at, u.auth_id is not null as has_sign_in from company_members m join app_users u on u.id = m.user_id
       where m.organisation_id = $1 order by (m.role = 'owner') desc, u.name`, [organisationId]),
    sql<Invitation>(`select ${INVITATION_COLUMNS} from invitations i left join app_users u on u.id = i.invited_by
      where i.organisation_id = $1 and i.accepted_at is null and i.revoked_at is null order by i.created_at desc`, [organisationId]),
  ]);
  return { members, invitations };
}

/**
 * The person to invite as a client company's owner: the contact on its client
 * file, or the company's own when the file has none.
 */
export const OWNER_CONTACT = `left join lateral (select id, contact_name, contact_email, imported_at from client_files
    where organisation_id = o.id and status = 'active' order by opened_at desc nulls last limit 1) f on true`;
export const OWNER_CONTACT_COLUMNS = `coalesce(nullif(btrim(f.contact_name), ''), nullif(btrim(o.contact_name), '')) as contact_name,
  lower(coalesce(nullif(btrim(f.contact_email), ''), nullif(btrim(o.contact_email), ''))) as contact_email`;

export type OwnerRow = {
  id: string; slug: string; name: string; he_number: string | null; vat_number: string | null; manager: string | null;
  contact_name: string | null; contact_email: string | null; file_id: string | null; imported: boolean;
  /** The owner who has joined, and since when. */
  owner_name: string | null; joined_at: string | null;
  /** The latest invitation waiting, open or expired. */
  invited_at: string | null; expires_at: string | null; expired: boolean;
};

/** Every client company's owner on Ledgerline: joined, invited and waiting, or still to invite. */
export async function getOwners(practiceId: string) {
  return sql<OwnerRow>(`select o.id, o.slug, o.name, o.he_number, o.vat_number, o.manager, ${OWNER_CONTACT_COLUMNS},
      f.id as file_id, f.imported_at is not null as imported, m.name as owner_name, m.created_at as joined_at,
      i.created_at as invited_at, i.expires_at, coalesce(i.expires_at < now(), false) as expired
    from organisations o ${OWNER_CONTACT}
    left join lateral (select u.name, cm.created_at from company_members cm join app_users u on u.id = cm.user_id
      where cm.organisation_id = o.id and cm.role = 'owner' order by cm.created_at limit 1) m on true
    left join lateral (select created_at, expires_at from invitations
      where organisation_id = o.id and role = 'owner' and accepted_at is null and revoked_at is null order by created_at desc limit 1) i on true
    where o.practice_id = $1 and not o.is_practice order by o.name`, [practiceId]);
}
