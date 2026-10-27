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
