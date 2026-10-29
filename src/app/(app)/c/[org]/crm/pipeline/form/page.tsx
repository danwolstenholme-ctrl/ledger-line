import type { Metadata } from "next";
import { headers } from "next/headers";
import { ExternalLink } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { sql } from "@/lib/db";
import { liveFormKey } from "@/lib/crm/intake";
import { getWorkspace } from "@/lib/data/workspace";
import { requireOrg } from "@/lib/org";
import { formatAgo, formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { CopyBlock, FormKeyActions } from "@/components/crm/forms";
import { RecordBadge, RecordEmpty, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Website form" };

/** Where a company's website meets its pipeline: the hosted form, the snippet for its own site, the API, and the key that ties them to this company. */
export default async function WebsiteFormPage() {
  const org = await requireOrg();
  const [key, recent, request, workspace] = await Promise.all([
    liveFormKey(org.id),
    sql<{ id: string; reference: string; full_name: string; company: string | null; channel: string; owner: string; created_at: string }>(
      "select id, reference, full_name, company, channel, owner, created_at from crm_enquiries where organisation_id = $1 and channel in ('form', 'api') order by created_at desc limit 6", [org.id]),
    headers(),
    getWorkspace(org.id),
  ]);
  const origin = `${request.get("x-forwarded-proto") ?? "http"}://${request.get("x-forwarded-host") ?? request.get("host") ?? "localhost:3000"}`;
  const base = `/c/${org.slug}/crm/pipeline`;

  const snippet = key ? `<form action="${origin}/api/v1/enquiries" method="post">
  <input type="hidden" name="key" value="${key.token}">
  <!-- Your own thank-you page. Leave it out to show ours. -->
  <input type="hidden" name="redirect" value="https://your-website.example/thank-you">
  <!-- Catches bots: people never see it. -->
  <div style="position:absolute;left:-10000px" aria-hidden="true"><input name="_trap" tabindex="-1" autocomplete="off"></div>

  <label>Your name <input name="name" required></label>
  <label>Company <input name="company"></label>
  <label>Email <input name="email" type="email"></label>
  <label>Phone <input name="phone" type="tel"></label>
  <label>What do you need? <input name="service"></label>
  <label>Anything else <textarea name="message"></textarea></label>
  <button type="submit">Send</button>
</form>` : "";
  const curl = key ? `curl -X POST ${origin}/api/v1/enquiries \\
  -H "Authorization: Bearer ${key.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Eleni Charalambous", "company": "Kypros Ferry Lines Ltd",
       "email": "eleni@kyprosferry.example", "service": "Bookkeeping and VAT"}'

# 201 Created
# {"id": "…", "reference": "…", "stage": "new", "owner": "…",
#  "next_action": "Call Eleni back", "next_action_due": "…"}` : "";

  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Website form" back={{ href: base, label: workspace.labels.deal[1] }}
      description="Enquiries from your website land straight in the pipeline."
      action={key ? <a href={`/f/${key.token}`} target="_blank" rel="noopener" className={recordOutlineButton}><ExternalLink className="size-3.5" />Open the form</a> : null} />

    <RecordSection title="The form" hint={key ? undefined : "Off"} action={key ? <RecordBadge tone="positive">Taking enquiries</RecordBadge> : <RecordBadge>Off</RecordBadge>}>
      <div className="space-y-3 px-4 py-3.5 text-[13px]">
        {key ? <p className="text-ink-muted">{key.uses ? `${key.uses} enquir${key.uses === 1 ? "y" : "ies"} sent with this key, the last ${formatAgo(key.last_used_at)}.` : "No enquiries sent with this key yet."} Key made {formatDate(key.created_at)}: <span className="text-ink font-mono">{key.token.slice(0, 12)}…</span></p>
          : <p className="text-ink-muted">The form is off, so nothing from a website can reach the pipeline. Turn it on to get a key, a hosted form and a snippet for your own site.</p>}
        <FormKeyActions live={Boolean(key)} />
        {key ? <p className="text-ink-faint text-[12px]">The key can only add enquiries, so it is safe in your website’s HTML. A new key stops the old one at once.</p> : null}
      </div>
    </RecordSection>

    {key ? <>
      <RecordSection title="On your own website" hint="Paste it where the form should go, and style it as you like">
        <div className="space-y-3 p-4">
          <CopyBlock label="The form" text={snippet} />
          <p className="text-ink-muted text-[12.5px]">Or link straight to the form, in your colours: <a href={`/f/${key.token}`} target="_blank" rel="noopener" className="text-brand font-mono hover:underline">{origin}/f/{key.token.slice(0, 12)}…</a></p>
        </div>
      </RecordSection>
      <RecordSection title="From your own code" hint="JSON in, JSON back">
        <div className="space-y-3 p-4"><CopyBlock label="Post an enquiry" text={curl} />
          <p className="text-ink-muted text-[12.5px]">Send <span className="font-mono">name</span> and an <span className="font-mono">email</span> or <span className="font-mono">phone</span>; <span className="font-mono">company</span>, <span className="font-mono">service</span>, <span className="font-mono">message</span> and <span className="font-mono">source</span> are optional. Up to 20 enquiries in 10 minutes from one key.</p>
        </div>
      </RecordSection>
    </> : null}

    <RecordSection title="Arrived from the web">
      {recent.length ? <ul className="divide-hairline divide-y">{recent.map(row => <li key={row.id}>
        <Link href={`${base}/${row.id}`} className="hover:bg-surface-sunken flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13px]">
          <span className="text-ink font-medium">{row.full_name}</span>
          <span className="text-ink-muted">{row.company ?? ""}</span>
          <span className="text-ink-faint">{row.channel === "api" ? "API" : "Form"} · {row.owner}</span>
          <span className="text-ink-faint ml-auto">{formatAgo(row.created_at)}</span>
        </Link>
      </li>)}</ul> : <RecordEmpty title="Nothing yet">Send a test from the form above: it appears here and on the board.</RecordEmpty>}
    </RecordSection>
  </PageBody>;
}
