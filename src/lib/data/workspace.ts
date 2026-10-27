import "server-only";

import { cache } from "react";

import { sql } from "@/lib/db";
import { MODULES, businessType, type Board, type Field, type Module, type Stage, type Workspace } from "@/lib/domain/business-types";

/**
 * How a company works, read once a request: its names, the parts it uses,
 * its stages and its fields. A company opened before it had any of these
 * reads as its business type would set it.
 */
export const getWorkspace = cache(async (organisationId: string): Promise<Workspace> => {
  const [settings, stages, fields, org] = await Promise.all([
    sql<{ customer_one: string; customer_many: string; deal_one: string; deal_many: string; job_one: string; job_many: string; modules: string[] }>(
      "select customer_one, customer_many, deal_one, deal_many, job_one, job_many, modules from workspace_settings where organisation_id = $1", [organisationId]),
    sql<Stage>("select id, board, name, position, outcome, probability from crm_stages where organisation_id = $1 order by board, position", [organisationId]),
    sql<Field>("select id, entity, key, label, kind, options, position, on_card from custom_fields where organisation_id = $1 and archived_at is null order by entity, position, label", [organisationId]),
    sql<{ business_type: string }>("select business_type from organisations where id = $1", [organisationId]),
  ]);
  const type = businessType(org[0]?.business_type);
  const row = settings[0];
  const byBoard = (board: Board) => stages.filter(stage => stage.board === board).map(stage => ({ ...stage, position: Number(stage.position), probability: stage.probability === null ? null : Number(stage.probability) }));
  return {
    typeKey: type.key,
    labels: row ? { customer: [row.customer_one, row.customer_many], deal: [row.deal_one, row.deal_many], job: [row.job_one, row.job_many] } : type.labels,
    modules: row ? MODULES.filter(module => row.modules.includes(module)) : type.modules as Module[],
    stages: { deal: byBoard("deal"), job: byBoard("job") },
    fields: fields.map(field => ({ ...field, position: Number(field.position), options: field.options ?? [] })),
  };
});
