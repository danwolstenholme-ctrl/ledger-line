import "server-only";

import { sql } from "@/lib/db";
import { formatAmount, formatDate } from "@/lib/format";
import { getOrgBySlug } from "@/lib/org";

/**
 * What the search finds as someone types: customers, suppliers, invoices,
 * bills, quotes, products, enquiries, jobs and employees, a few of each, in
 * one company or across every company the person can see. Row-level
 * security decides what that is, as everywhere else.
 */

export type SearchKind = "customer" | "supplier" | "invoice" | "bill" | "quote" | "product" | "deal" | "job" | "employee";
export type SearchHit = { kind: SearchKind; id: string; title: string; detail: string; href: string };

const PATH: Record<SearchKind, string> = {
  customer: "customers", supplier: "suppliers", invoice: "sales", bill: "bills", quote: "quotes", product: "items",
  deal: "crm/pipeline", job: "crm/jobs", employee: "payroll/employees",
};
const EACH = 5;

type Row = { kind: SearchKind; id: string; title: string; detail: string | null; slug: string; company: string; currency: string; day: string | null; amount: string | null };

export async function searchRecords(typed: string, slug: string | null): Promise<SearchHit[]> {
  const term = typed.trim().slice(0, 80);
  if (term.length < 2) return [];
  const org = slug ? await getOrgBySlug(slug) : null;
  if (slug && !org) return [];
  // Matched anywhere, without case; % and _ typed are taken literally. Names that start with it come first.
  const pattern = `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const start = `${term.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const rows = await sql<Row>(`
    (select 'customer' as kind, c.id, c.name as title, coalesce(c.email, c.vat_number) as detail, o.slug, o.name as company, o.currency, null::text as day, null::text as amount
       from customers c join organisations o on o.id = c.organisation_id
      where ($3::uuid is null or c.organisation_id = $3) and (c.name ilike $1 or c.email ilike $1 or c.vat_number ilike $1)
      order by c.name ilike $2 desc, c.name limit ${EACH})
    union all
    (select 'supplier', s.id, s.name, coalesce(s.email, s.vat_number), o.slug, o.name, o.currency, null, null
       from suppliers s join organisations o on o.id = s.organisation_id
      where ($3::uuid is null or s.organisation_id = $3) and (s.name ilike $1 or s.email ilike $1 or s.vat_number ilike $1)
      order by s.name ilike $2 desc, s.name limit ${EACH})
    union all
    (select 'invoice', i.id, i.number, c.name, o.slug, o.name, o.currency, i.issued_on::text, i.total::text
       from invoices i join customers c on c.id = i.customer_id join organisations o on o.id = i.organisation_id
      where ($3::uuid is null or i.organisation_id = $3) and (i.number ilike $1 or c.name ilike $1 or i.reference ilike $1)
      order by i.number ilike $1 desc, i.issued_on desc limit ${EACH})
    union all
    (select 'bill', b.id, coalesce(b.number, s.name), s.name, o.slug, o.name, o.currency, b.issued_on::text, b.total::text
       from bills b join suppliers s on s.id = b.supplier_id join organisations o on o.id = b.organisation_id
      where ($3::uuid is null or b.organisation_id = $3) and (b.number ilike $1 or s.name ilike $1 or b.reference ilike $1)
      order by b.number ilike $1 desc, b.issued_on desc limit ${EACH})
    union all
    (select 'quote', q.id, q.number, c.name, o.slug, o.name, o.currency, q.issued_on::text, q.total::text
       from quotes q join customers c on c.id = q.customer_id join organisations o on o.id = q.organisation_id
      where ($3::uuid is null or q.organisation_id = $3) and (q.number ilike $1 or c.name ilike $1)
      order by q.number ilike $1 desc, q.issued_on desc limit ${EACH})
    union all
    (select 'product', p.id, p.name, p.code, o.slug, o.name, o.currency, null, null
       from items p join organisations o on o.id = p.organisation_id
      where ($3::uuid is null or p.organisation_id = $3) and (p.name ilike $1 or p.code ilike $1)
      order by p.name ilike $2 desc, p.name limit ${EACH})
    union all
    (select 'deal', e.id, coalesce(nullif(e.company, ''), e.full_name), case when nullif(e.company, '') is null then '#' || e.reference else e.full_name || ' · #' || e.reference end, o.slug, o.name, o.currency, null, null
       from crm_enquiries e join organisations o on o.id = e.organisation_id
      where ($3::uuid is null or e.organisation_id = $3) and (e.full_name ilike $1 or e.company ilike $1 or e.reference ilike $1 or e.email ilike $1)
      order by e.created_at desc limit ${EACH})
    union all
    (select 'job', j.id, j.title, '#' || j.reference, o.slug, o.name, o.currency, null, null
       from crm_jobs j join organisations o on o.id = j.organisation_id
      where ($3::uuid is null or j.organisation_id = $3) and (j.title ilike $1 or j.reference ilike $1)
      order by j.created_at desc limit ${EACH})
    union all
    (select 'employee', m.id, m.name, m.email, o.slug, o.name, o.currency, null, null
       from employees m join organisations o on o.id = m.organisation_id
      where ($3::uuid is null or m.organisation_id = $3) and m.name ilike $1
      order by m.name limit ${EACH})`, [pattern, start, org?.id ?? null]);
  return rows.map(row => {
    const parts = [
      ...(org ? [] : [row.company.replace(/ (Ltd|Limited)$/, "")]),
      row.detail,
      row.day ? formatDate(row.day) : null,
      row.amount !== null ? formatAmount(Number(row.amount), row.currency) : null,
    ].filter((part): part is string => Boolean(part));
    return { kind: row.kind, id: row.id, title: row.title, detail: parts.join(" · "), href: `/c/${row.slug}/${PATH[row.kind]}/${row.id}` };
  });
}
