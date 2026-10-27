import type { Metadata } from "next";

import { sql } from "@/lib/db";
import { getWorkspace } from "@/lib/data/workspace";
import { BUSINESS_TYPES, FIELD_KIND_LABELS, businessType, closingStage, fieldsFor, type FieldEntity } from "@/lib/domain/business-types";
import { getMembership, requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordBadge, RecordDisclosure, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { BusinessTypeForm, FieldEditor, ModulesForm, NamesForm, NewFieldForm, StageEditor } from "@/components/workspace/workspace-forms";

export const metadata: Metadata = { title: "How the company works" };

/**
 * How a company works, shaped by its accountant or its owner: the kind of
 * business it is, what it calls things, the parts it uses, the stages of its
 * pipeline and its work, and the details it keeps. Everyone else sees it.
 */
export default async function WorkspacePage() {
  const [org, membership] = await Promise.all([requireOrg(), getMembership()]);
  const [workspace, counts] = await Promise.all([getWorkspace(org.id),
    sql<{ stage_id: string; n: number }>(`select stage_id, count(*)::int as n from crm_enquiries where organisation_id = $1 group by 1
      union all select stage_id, count(*)::int from crm_jobs where organisation_id = $1 group by 1`, [org.id])]);
  const allowed = membership.practice || membership.companies.some(company => company.slug === org.slug && company.role === "owner");
  const type = businessType(workspace.typeKey);
  const used = Object.fromEntries(counts.map(row => [row.stage_id, Number(row.n)]));
  const { labels } = workspace;
  const entities: { key: FieldEntity; label: string }[] = [{ key: "customer", label: labels.customer[1] }, { key: "deal", label: labels.deal[1] }, { key: "job", label: labels.job[1] }];
  const closing = (board: "deal" | "job") => ({ won: board === "deal" ? "Closes it as won" : "Closes it as done", lost: board === "deal" ? "Closes it as lost" : "Closes it as cancelled" });
  const stageKey = (board: "deal" | "job") => workspace.stages[board].map(stage => `${stage.id}:${stage.name}:${stage.position}:${stage.probability}`).join("|");

  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title={`How ${org.name.replace(/ (Ltd|Limited|LLP)$/, "")} works`}
      description={`What it calls things, the parts of Ledgerline it uses, the stages its ${labels.deal[1].toLowerCase()} and ${labels.job[1].toLowerCase()} go through, and the details it keeps. Set from its business type; change any of it.`} />
    {!allowed ? <p role="note" className="border-hairline bg-surface-sunken text-ink-muted rounded-md border px-3 py-2 text-[12.5px]">The company’s owner or its accountant sets these. You can see them here.</p> : null}

    <RecordSection title="Kind of business">
      <div className="px-4 py-3.5">{allowed ? <BusinessTypeForm current={type.key} types={BUSINESS_TYPES.map(({ key, label, examples }) => ({ key, label, examples }))} /> : <p className="text-ink text-[13px] font-medium">{type.label}</p>}</div>
    </RecordSection>

    <RecordSection title="What it calls things">
      <div className="px-4 py-3.5">{allowed ? <NamesForm labels={labels} /> : <p className="text-ink text-[12.5px]">{labels.customer[1]} · {labels.deal[1]} · {labels.job[1]}</p>}</div>
    </RecordSection>

    <RecordSection title="The parts it uses">
      <div className="px-4 py-3.5">{allowed ? <ModulesForm modules={workspace.modules} labels={labels} country={org.country} /> : <p className="text-ink text-[12.5px]">{workspace.modules.join(", ")}</p>}</div>
    </RecordSection>

    {(["deal", "job"] as const).map(board => <RecordSection key={board} title={`${labels[board][1]}: the stages`}
      hint={board === "deal" ? "The likelihood weighs the pipeline’s value" : `${closingStage(workspace, "job", "won")?.name ?? "Done"} closes the work`}>
      <div className="px-4 py-3">{allowed ? <StageEditor key={stageKey(board)} board={board} stages={workspace.stages[board]} counts={used} closingNames={closing(board)} />
        : <p className="text-ink text-[12.5px]">{workspace.stages[board].map(stage => stage.name).join(" → ")}</p>}</div>
    </RecordSection>)}

    <RecordSection title="The details it keeps" hint="Beyond the usual: a vessel and its port, a site address, a fee basis">
      {entities.map(entity => {
        const fields = fieldsFor(workspace, entity.key);
        return <div key={entity.key} className="border-hairline border-t first:border-t-0">
          <p className="text-ink-muted bg-surface-sunken px-4 py-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase">On {entity.label.toLowerCase()}</p>
          {fields.length ? <ul className="divide-hairline divide-y">{fields.map(field => <li key={field.id}>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-2.5">
              <span className="text-ink text-[12.5px] font-medium">{field.label}</span>
              <span className="text-ink-faint text-[11.5px]">{FIELD_KIND_LABELS[field.kind]}{field.kind === "choice" ? `: ${field.options.join(", ")}` : ""}</span>
              {field.on_card ? <RecordBadge>On the cards</RecordBadge> : null}
            </div>
            {allowed ? <RecordDisclosure title="Change"><FieldEditor field={field} /></RecordDisclosure> : <div className="pb-2.5" />}
          </li>)}</ul> : <p className="text-ink-faint px-4 py-2.5 text-[12px]">None.</p>}
        </div>;
      })}
      {allowed ? <div className="border-hairline border-t px-4 py-3.5"><p className="text-ink mb-2 text-[12.5px] font-semibold">Add a detail</p><NewFieldForm entities={entities} /></div> : null}
    </RecordSection>
    {type.note ? <Panel className="px-4 py-3"><p className="text-ink-muted text-[12px] leading-relaxed">{type.note}</p></Panel> : null}
  </PageBody>;
}
