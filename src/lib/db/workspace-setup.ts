import { BOARDS, businessType, type FieldSpec, type Labels, type Module, type StageSpec } from "@/lib/domain/business-types";

/**
 * Setting a company up from its business type: what it calls things, the
 * parts it uses, the stages of its pipeline and its jobs, and the extra
 * details it keeps. Used when a company is opened (and by the demo data), and
 * when a company changes its business type: its names and parts follow the
 * new type, a board whose stages no record is in yet takes the new stages,
 * and fields it lacks are added. Nothing a company has recorded is lost.
 * No "server-only": the seed runs it from scripts too.
 */

type Query = (text: string, params?: unknown[]) => Promise<unknown>;
type Rows = <T>(text: string, params?: unknown[]) => Promise<T[]>;

export type WorkspaceChanges = { labels?: Partial<Labels>; modules?: Module[]; stages?: { deal?: StageSpec[]; job?: StageSpec[] }; fields?: FieldSpec[] };

export async function setUpWorkspace(query: Query, rows: Rows, organisationId: string, typeKey: string, country: string, changes: WorkspaceChanges = {}) {
  const type = businessType(typeKey);
  const labels: Labels = { ...type.labels, ...changes.labels };
  // Cyprus payroll is for Cyprus companies.
  const modules = (changes.modules ?? type.modules).filter(module => module !== "payroll" || country === "CY");
  await query("update organisations set business_type = $2 where id = $1", [organisationId, type.key]);
  await query(`insert into workspace_settings (organisation_id, customer_one, customer_many, deal_one, deal_many, job_one, job_many, modules)
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (organisation_id) do update set customer_one = excluded.customer_one, customer_many = excluded.customer_many, deal_one = excluded.deal_one,
      deal_many = excluded.deal_many, job_one = excluded.job_one, job_many = excluded.job_many, modules = excluded.modules, updated_at = now()`,
    [organisationId, labels.customer[0], labels.customer[1], labels.deal[0], labels.deal[1], labels.job[0], labels.job[1], modules]);
  for (const board of BOARDS) {
    const specs = changes.stages?.[board] ?? type[board];
    const [inUse] = await rows<{ n: number }>(board === "deal"
      ? "select count(*)::int as n from crm_enquiries where organisation_id = $1" : "select count(*)::int as n from crm_jobs where organisation_id = $1", [organisationId]);
    if (Number(inUse?.n ?? 0) > 0) continue;
    await query("delete from crm_stages where organisation_id = $1 and board = $2", [organisationId, board]);
    for (const [index, stage] of specs.entries())
      await query("insert into crm_stages (organisation_id, board, name, position, outcome, probability) values ($1, $2, $3, $4, $5, $6)",
        [organisationId, board, stage.name, index + 1, stage.outcome ?? "open", board === "deal" ? stage.probability ?? null : null]);
  }
  for (const [index, field] of (changes.fields ?? type.fields).entries())
    await query(`insert into custom_fields (organisation_id, entity, key, label, kind, options, position, on_card) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (organisation_id, entity, key) do update set archived_at = null`,
      [organisationId, field.entity, field.key, field.label, field.kind, field.options ?? [], index + 1, Boolean(field.onCard)]);
}
