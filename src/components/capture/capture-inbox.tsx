import Link from "@/components/navigation/navigation-link";
import { CheckCircle2 } from "lucide-react";

import { sql } from "@/lib/db";
import { captureAvailable, checkInvoice, draftFor, rehearsalMode, type CaptureCheck, type CaptureDraft, type CaptureRouting } from "@/lib/capture";
import type { OrganisationRow } from "@/types/database";
import type { CapturedInvoice } from "@/lib/ai/capture";
import { codableAccounts, type PickerAccount } from "@/lib/domain/accounts";
import { formatAmount, formatRelative } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { DropZone } from "@/components/capture/drop-zone";
import { ReviewCard, type ReviewClient, type ReviewItem } from "@/components/capture/review-card";
import { PostReady } from "@/components/capture/post-ready";

type ItemRow = { id: string; file_id: string; file_name: string; media_type: string; organisation_id: string | null; routing: CaptureRouting; extraction: CapturedInvoice;
  checks: CaptureCheck[]; draft: CaptureDraft | Record<string, never>; status: string; bill_id: string | null; posted_at: string | null; org_slug: string | null; org_name: string | null };

/**
 * Journey 2: the practice's inbox, or one company's when `company` is given.
 * Drop a mixed batch; each invoice found is read, checked, routed to its
 * client and drafted as a bill, then waits here for a person to post it.
 */
export async function CaptureInbox({ company }: { company?: OrganisationRow }) {
  const [items, orgs] = await Promise.all([
    sql<ItemRow>(`select i.*, f.file_name, f.media_type, o.slug as org_slug, o.name as org_name
                    from capture_items i join capture_files f on f.id = i.file_id left join organisations o on o.id = i.organisation_id
                   where i.status in ('review', 'posted') ${company ? "and i.organisation_id = $1" : ""} order by i.status = 'posted', i.created_at desc, i.position`, company ? [company.id] : []),
    sql<OrganisationRow>("select * from organisations order by name"),
  ]);
  // The accounts and suppliers of the clients the documents are for, and only theirs: moving a document to another client
  // drafts it again there. Every client's would be megabytes at a few hundred clients.
  const routed = [...new Set(items.filter(item => item.status === "review" && item.organisation_id).map(item => item.organisation_id as string))];
  const [accounts, suppliers] = routed.length ? await Promise.all([
    sql<PickerAccount & { organisation_id: string }>("select id, organisation_id, code, name, type, system_role from ledger_accounts where is_active and organisation_id = any($1::uuid[]) order by code", [routed]),
    sql<{ id: string; organisation_id: string; name: string }>("select id, organisation_id, name from suppliers where is_active and organisation_id = any($1::uuid[]) order by name", [routed]),
  ]) : [[], []];
  // Documents captured before this session carry only Claude's reading: draft them in their client's books now.
  for (const item of items) {
    const org = orgs.find(entry => entry.id === item.organisation_id);
    if (item.status === "review" && org && !("lines" in item.draft)) {
      const draft = await draftFor(org, item.extraction);
      item.draft = draft;
      item.checks = checkInvoice(item.extraction, false);
    }
  }
  const clients: ReviewClient[] = orgs.map(org => ({ id: org.id, name: org.name, slug: org.slug, accounts: codableAccounts(accounts.filter(account => account.organisation_id === org.id)), suppliers: suppliers.filter(supplier => supplier.organisation_id === org.id) }));
  const review = items.filter(item => item.status === "review");
  const posted = items.filter(item => item.status === "posted").slice(0, 12);
  const view = (item: ItemRow): ReviewItem => ({
    id: item.id, fileId: item.file_id, fileName: item.file_name, mediaType: item.media_type, pages: item.extraction.pages ?? "", language: item.extraction.language ?? "en",
    supplier: item.extraction.supplier, billedTo: item.extraction.bill_to?.name ?? null, billedToVat: item.extraction.bill_to?.vat_number ?? null,
    number: item.extraction.invoice_number, issueDate: item.extraction.issue_date, dueDate: item.extraction.due_date, totals: item.extraction.totals,
    warnings: item.extraction.warnings ?? [], photo: Boolean(item.extraction.handwritten_or_photo), organisationId: item.organisation_id, routing: item.routing,
    checks: item.checks ?? [], draft: "lines" in item.draft ? item.draft as CaptureDraft : null,
  });
  const ready = review.filter(item => item.organisation_id && item.routing.confidence === "high" && (item.checks ?? []).every(check => check.ok) && "lines" in item.draft);
  return <PageBody className="space-y-4">
    <RecordHeader title={company ? "Upload receipts" : "Capture"} description={company
      ? `Receipts and supplier invoices for ${company.name}. Each is read, checked and drafted as a bill. Nothing posts until you confirm it.`
      : "One inbox for every client. Claude reads the documents; Ledgerline checks the arithmetic, routes each invoice to the right company, matches or creates the supplier, suggests the accounts and drafts the bill. Nothing posts until you say so."} />
    <DropZone available={captureAvailable()} rehearsal={rehearsalMode()} company={company ? { id: company.id, name: company.name } : undefined} />
    <section aria-label="To review" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ink text-[13.5px] font-semibold">To review <span className="text-ink-faint font-normal tabular-nums">{review.length}</span></h2>
        <PostReady ids={ready.map(item => item.id)} />
      </div>
      {review.length ? <ul className="space-y-2">{review.map(item => <ReviewCard key={item.id} item={view(item)} clients={clients} />)}</ul>
        : <p className="ll-panel text-ink-muted px-4 py-4 text-[12.5px]">{company ? "Nothing waiting. Drop a receipt or an invoice above." : "Nothing waiting. Drop a batch above: invoices from several clients can go in together."}</p>}
    </section>
    {posted.length ? <section aria-label="Posted" className="ll-panel overflow-hidden">
      <h2 className="border-hairline text-ink border-b px-4 py-2 text-[13px] font-semibold">Posted from capture</h2>
      <ul className="divide-hairline divide-y">{posted.map(item => <li key={item.id}>
        <Link href={`/c/${item.org_slug}/bills/${item.bill_id}`} className="hover:bg-surface-sunken flex items-center gap-3 px-4 py-2 text-[12.5px]">
          <CheckCircle2 className="text-positive size-3.5 shrink-0" />
          <span className="text-ink min-w-0 flex-1 truncate">{item.extraction.supplier.name_latin}{item.extraction.invoice_number ? ` · ${item.extraction.invoice_number}` : ""}</span>
          {company ? null : <span className="text-ink-muted shrink-0">{item.org_name}</span>}
          <span className="text-ink w-24 shrink-0 text-right tabular-nums">{formatAmount(item.extraction.totals.total)}</span>
          <span className="text-ink-faint w-16 shrink-0 text-right">{item.posted_at ? formatRelative(item.posted_at) : ""}</span>
        </Link>
      </li>)}</ul>
    </section> : null}
  </PageBody>;
}
