import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { FileUp } from "lucide-react";

import { requireOrg } from "@/lib/org";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getMatchCandidates, getMatchedDocuments, getReconcileView, LINES_PAGE, RECONCILE_VIEWS, type ReconcileView } from "@/lib/data/bank";
import { codableAccounts } from "@/lib/domain/accounts";
import { suggestMatches, type Suggestion } from "@/lib/domain/bank-statements";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel, PanelHeader } from "@/components/common/primitives";
import { ImportHistory } from "@/components/bank/import-history";
import { ReconcileList, type ReconcileLine } from "@/components/bank/reconcile-list";
import { RecordEmpty, RecordFailure, RecordFilterLinks, RecordHeader, RecordPagination, recordButton } from "@/components/records/record-layout";
import { StatTile } from "@/components/reports/report-charts";
import type { BankMatchItem } from "@/types/database";

export const metadata: Metadata = { title: "Reconcile" };

const VIEW_LABELS: Record<ReconcileView, string> = { to_match: "To match", matched: "Matched", set_aside: "Set aside" };
const DOCUMENT_HREF = { invoice_payment: "/invoices/", bill_payment: "/accounts/bills/", bank_transaction: "/accounts/bank/transactions/" } as const;

/** What a suggestion would use up, so two lines are never both sure of the same invoice, bill or payment. */
const claims = (item: BankMatchItem) => item.kind === "invoice" ? `invoice:${item.invoice_id}` : item.kind === "bill" ? `bill:${item.bill_id}` : "id" in item ? `${item.kind}:${item.id}` : null;

/**
 * One bank account against its statements: each line the bank reports,
 * matched to what the books already hold or recorded from here, until the
 * bank's balance and the books agree.
 */
export default async function ReconcilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const query = await searchParams;
  const view = RECONCILE_VIEWS.find(item => item === query.view) ?? "to_match";
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(query.page) || 1)));
  const [data, candidates] = await Promise.all([getReconcileView(id, view, page), view === "to_match" ? getMatchCandidates() : null]);
  if (!data.failed && (!data.account || data.account.type !== "bank")) notFound();
  if (data.failed || !data.account) return <PageBody><RecordFailure what="this bank account’s statements" /></PageBody>;
  const account = data.account;
  const documents = view === "matched" ? await getMatchedDocuments(data.lines.map(line => line.id)) : null;

  const lines: ReconcileLine[] = data.lines.map(line => ({
    id: line.id, txn_date: line.txn_date, amount: Number(line.amount), description: line.description, reference: line.reference, counterparty: line.counterparty,
    status: line.status, matched_amount: Number(line.matched_amount), excluded_reason: line.excluded_reason,
  }));
  const suggestions: Record<string, Suggestion[]> = {};
  if (candidates && !candidates.failed) {
    const claimed = new Set<string>();
    for (const line of lines.filter(item => item.status === "unmatched")) {
      const found = suggestMatches({ date: line.txn_date, amount: line.amount, description: line.description, reference: line.reference, counterparty: line.counterparty },
        { unreconciled: data.unreconciled, invoices: candidates.invoices, bills: candidates.bills, examples: candidates.examples });
      const [top] = found;
      if (top?.confidence === "high") {
        const keys = top.items.map(claims).filter((key): key is string => Boolean(key));
        if (keys.some(key => claimed.has(key))) found[0] = { ...top, confidence: "medium", reason: `${top.reason}; another line fits it too` };
        else keys.forEach(key => claimed.add(key));
      }
      suggestions[line.id] = found;
    }
  }
  const banks = data.accounts.filter(item => item.type === "bank" && item.id !== account.id).map(item => ({ id: item.id, code: item.code, name: item.name }));
  const bankFees = data.accounts.find(item => item.type === "expense" && item.code === "404") ?? data.accounts.find(item => item.type === "expense" && /bank (fees|charges)/i.test(item.name));
  const { summary } = data;
  const counts = data.counts;
  const href = (next: { view?: ReconcileView; page?: number }) => {
    const search = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "to_match") search.set("view", nextView);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    return `/accounts/bank/${account.id}${search.size ? `?${search}` : ""}`;
  };
  const imported = typeof query.imported === "string" ? Number(query.imported) : null;
  const skipped = typeof query.skipped === "string" ? Number(query.skipped) : 0;
  const hasLines = counts.to_match + counts.matched + counts.set_aside > 0;

  return <PageBody className="space-y-4">
    <RecordHeader title={`Reconcile · ${account.name}`} back={{ href: "/accounts/bank", label: "Bank" }}
      description="Match each line of the bank’s statement to what the books hold. Anything not in the books yet can be recorded from here."
      action={<>
        <Link href={`/accounts/bank/${account.id}/import`} className={recordButton}><FileUp className="size-4" />Import a statement</Link>
      </>} />
    {imported !== null && Number.isFinite(imported) ? <p role="status" className="border-positive-line bg-positive-soft text-positive rounded-lg border px-4 py-2.5 text-[12.5px]">
      Imported {imported} line{imported === 1 ? "" : "s"}.{skipped ? ` ${skipped} ${skipped === 1 ? "was" : "were"} already here and left as they were.` : ""}
    </p> : null}

    {hasLines ? <section aria-label="Reconciliation" className="ll-panel divide-hairline grid grid-cols-2 divide-x divide-y overflow-hidden lg:grid-cols-4 lg:divide-y-0">
      <StatTile label="In the books" value={formatAmount(summary.bookBalance)} context="Today" />
      <StatTile label="The bank should show" value={formatAmount(summary.expected)} context={summary.to ? `On ${formatDate(summary.to)}, the last statement line` : undefined} />
      <StatTile label="The bank says" value={summary.bankBalance === null ? "—" : formatAmount(summary.bankBalance)} context={summary.bankBalance === null ? "Check online banking: no closing balance came with the latest lines" : "The latest statement’s closing balance"} />
      <StatTile label={summary.reconciled ? "Reconciled" : "Difference"} tone={summary.difference ? "critical" : undefined}
        value={summary.difference === null ? "—" : summary.reconciled ? "Agrees" : formatAmount(summary.difference)}
        context={summary.difference === null ? undefined : summary.difference !== 0 ? (counts.to_match ? "Match the lines below, then compare again" : "Look for a missing line or a wrong balance") : counts.to_match ? `Once the ${counts.to_match} line${counts.to_match === 1 ? "" : "s"} to match are done` : `Every line matched since ${formatDate(summary.from)}`} />
    </section> : null}

    <Panel className="overflow-hidden">
      <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <RecordFilterLinks label="Statement lines" options={RECONCILE_VIEWS.map(item => ({ label: `${VIEW_LABELS[item]}${counts[item] ? ` · ${counts[item]}` : ""}`, href: href({ view: item }), active: view === item }))} />
      </div>
      {candidates?.failed ? <div className="px-4 pt-3"><RecordFailure what="the open invoices and bills to suggest" /></div> : null}
      {!hasLines ? <RecordEmpty title="No statement imported yet">
        Download a statement from online banking for this account — CSV, CAMT.053 or OFX — and <Link href={`/accounts/bank/${account.id}/import`} className="text-brand hover:underline">import it</Link>. Each line can then be matched here.
      </RecordEmpty> : !lines.length ? <RecordEmpty title={view === "to_match" ? "Nothing to match" : view === "matched" ? "Nothing matched yet" : "Nothing set aside"}>
        {view === "to_match" ? "Every imported line is matched. Import the next statement when it is ready." : view === "matched" ? "Lines appear here once matched." : "Lines that are not for the books, such as a payment reversed the same day, appear here."}
      </RecordEmpty> : <ReconcileList view={view} lines={lines} suggestions={suggestions}
        documents={documents ? Object.fromEntries(documents.documents) : {}}
        candidates={{
          invoices: candidates?.invoices ?? [], bills: candidates?.bills ?? [],
          recorded: data.unreconciled.map(item => ({ kind: item.kind, id: item.id, item_date: item.item_date, amount: Number(item.amount), label: item.label, reference: item.reference })),
          banks, accounts: codableAccounts(data.accounts, { vat: true }), bankFeesAccountId: bankFees?.id ?? null,
        }}
        ai={{ available: data.aiSuggestions && aiConfigured(), note: !aiConfigured() ? "Add ANTHROPIC_API_KEY to .env.local to let Claude suggest the rest." : null }} />}
      {data.total > LINES_PAGE ? <RecordPagination page={page} total={data.total} pageSize={LINES_PAGE} href={href({})} /> : null}
    </Panel>

    {data.outstanding.length ? <Panel className="overflow-hidden">
      <PanelHeader title="In the books, not on a statement yet" hint="Recorded since the statements began; each clears when its line is matched" />
      <ul className="divide-hairline divide-y">{data.outstanding.map(item => <li key={`${item.kind}-${item.id}`}>
        <Link href={`${DOCUMENT_HREF[item.kind]}${item.document_id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2 touch:min-h-11">
          <span className="text-ink-muted w-[5.5rem] shrink-0 text-[12px] tabular-nums">{formatDate(item.item_date)}</span>
          <span className="text-ink min-w-0 flex-1 truncate text-[12.5px]">{item.label}{item.reference ? <span className="text-ink-faint"> · {item.reference}</span> : null}</span>
          <span className={cn("shrink-0 text-[12.5px] tabular-nums", Number(item.amount) > 0 ? "text-positive" : "text-ink")}>{Number(item.amount) < 0 ? "−" : ""}{formatAmount(Math.abs(Number(item.amount)))}</span>
        </Link>
      </li>)}</ul>
    </Panel> : null}

    {data.imports.length ? <Panel className="overflow-hidden">
      <PanelHeader title="Statements imported" hint="Undoing one removes the lines it added, except any already matched" />
      <ImportHistory imports={data.imports.map(item => ({ id: item.id, source: item.source, file_name: item.file_name, added: item.added, skipped: item.skipped, first_date: item.first_date, last_date: item.last_date, imported_at: item.imported_at }))} />
    </Panel> : null}
  </PageBody>;
}
