import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

import { takeOnFromEnquiry } from "@/lib/actions/clients";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { SubmitButton } from "@/components/common/form-fields";
import { RecordHeader, RecordSection } from "@/components/records/record-layout";
import { StartClientForm } from "@/components/clients/forms";

export const metadata: Metadata = { title: "Take on a client" };

/** A new client file: from an enquiry the practice won, or from scratch. */
export default async function NewClientPage() {
  const won = await sql<{ id: string; reference: string; full_name: string; company: string | null; service: string | null; stage_changed_at: string }>(`
    select e.id, e.reference, e.full_name, e.company, e.service, e.stage_changed_at from crm_enquiries e join organisations o on o.id = e.organisation_id and o.is_practice
      join crm_stages s on s.id = e.stage_id
     where s.outcome = 'won' and not exists (select 1 from client_files f where f.enquiry_id = e.id) order by e.stage_changed_at desc`);
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader back={{ href: "/clients", label: "Client files" }} title="Take on a client" description="Start the client’s file. Ledgerline asks for what due diligence needs as you go, and opens the books once it is done." />
    {won.length ? <RecordSection title="Won enquiries" hint="From the firm’s own pipeline">
      <ul className="divide-hairline divide-y">{won.map(enquiry => <li key={enquiry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0"><span className="text-ink block text-[13.5px] font-medium">{enquiry.company ?? enquiry.full_name}</span>
          <span className="text-ink-faint block text-[12px]">{enquiry.full_name}{enquiry.service ? ` · ${enquiry.service}` : ""} · won {formatDate(enquiry.stage_changed_at.slice(0, 10))} · {enquiry.reference}</span></span>
        <form action={takeOnFromEnquiry}><input type="hidden" name="enquiry_id" value={enquiry.id} /><SubmitButton size="sm" pendingLabel="Starting…">Start their file<ArrowRight className="size-3.5" /></SubmitButton></form>
      </li>)}</ul>
    </RecordSection> : null}
    <RecordSection title={won.length ? "Or someone new" : "The client"}><div className="p-4"><StartClientForm /></div></RecordSection>
  </PageBody>;
}
