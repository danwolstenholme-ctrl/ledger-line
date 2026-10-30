import type { Metadata } from "next";
import { CheckCircle2, ShieldAlert } from "lucide-react";

import { one, sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import { cn } from "@/lib/utils";
import { formatAmount, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { periodLabel } from "@/components/accounts/report-parts";
import { RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Audit trail" };

const LIMIT = 150;

const ENTITIES: Record<string, string> = { invoice: "Sales invoice", credit_note: "Credit note", supplier_credit: "Supplier's credit note", invoice_payment: "Payment received", bill: "Bill", bill_payment: "Bill payment", bank: "Bank entry", manual: "Journal", bank_line: "Bank line", captured_bill: "Bill from capture" };
const VERBS: Record<string, string> = { posted: "posted", reversed: "reversed", matched: "matched", unmatched: "unmatched" };

/** A client file's events, on the practice's own trail. */
const CLIENT_EVENTS: Record<string, string> = {
  "client_file:opened": "Client file started", "client_file:active": "Client taken on: books opened", "client_file:declined": "Client declined",
  "engagement_letter:sent": "Engagement letter sent", "engagement_letter:signed": "Engagement letter signed", "client_document:received": "Due diligence document received",
  "sanctions:screened": "Screened against the EU sanctions list", "sanctions:resolved": "Possible sanctions match decided",
  "risk:assessed": "Risk assessed", "risk:approved": "Risk rating approved",
  "invitation:invited": "Invitation sent", "invitation:accepted": "Invitation accepted: joined", "invitation:revoked": "Invitation withdrawn",
  "document_link:shared": "Shared with the customer as a link", "document_link:stopped": "Customer’s link stopped", "document_link:accepted": "Quote accepted online by the customer",
  "year_end:updated": "Year end updated",
};

type AuditRow = { seq: number; at: string; actor: string; action: string; entity: string; detail: Record<string, unknown>; hash: string; prev_hash: string };

/** What happened, in words: "Bill posted", "Lock date moved", "VAT return filed". */
function headline(row: AuditRow) {
  if (row.action === "locked") return "Lock date moved";
  if (row.action === "filed") return "VAT return filed";
  if (row.action === "checked") return "VAT number checked in VIES";
  if (row.action === "reconciled") return "Supplier's statement checked";
  const client = CLIENT_EVENTS[`${row.entity}:${row.action}`];
  if (client) return client;
  return `${ENTITIES[row.entity] ?? row.entity} ${VERBS[row.action] ?? row.action}`;
}

function describe(row: AuditRow) {
  const detail = row.detail ?? {};
  const day = (value: unknown) => typeof value === "string" && value ? formatDate(value) : null;
  if (row.action === "locked") return detail.to ? `Locked up to ${day(detail.to)}${detail.from ? `, from ${day(detail.from)}` : ""}` : `Unlocked${detail.from ? `, from ${day(detail.from)}` : ""}`;
  if (row.action === "filed") return `${periodLabel(String(detail.from), String(detail.to))} · net VAT ${formatAmount(Number(detail.net_vat ?? 0))}`;
  if (row.action === "reconciled") return `${detail.supplier}, statement of ${day(detail.date)}: theirs ${formatAmount(Number(detail.theirs ?? 0))}, ours ${formatAmount(Number(detail.ours ?? 0))}${Number(detail.unexplained) ? `, ${formatAmount(Number(detail.unexplained))} not explained` : ", agreed"}`;
  if (CLIENT_EVENTS[`${row.entity}:${row.action}`]) {
    const parts: unknown[] = [detail.company];
    if (row.entity === "engagement_letter") parts.push(detail.by ? `by ${detail.by}` : null, detail.ip ? `from ${detail.ip}` : null, detail.hash ? `fingerprint ${String(detail.hash).slice(0, 12)}…` : null);
    if (row.entity === "client_document") parts.push(detail.document, detail.file, detail.sha256 ? `SHA-256 ${String(detail.sha256).slice(0, 12)}…` : null);
    if (row.entity === "sanctions") parts.push(detail.name, row.action === "screened" ? (detail.result === "clear" ? `clear on the list of ${day(detail.list)}` : `${detail.matches} possible match${detail.matches === 1 ? "" : "es"}`) : `${detail.resolution === "confirmed" ? "confirmed" : "not the same"}: ${detail.note}`);
    if (row.entity === "risk") parts.push(row.action === "assessed" ? `${detail.level} risk, ${detail.total} of 20${detail.forced ? `: ${detail.forced}` : ""}` : `${detail.level} risk, approved as ${detail.as === "partner" ? "partner" : "compliance officer"}, next review ${day(detail.next_review)}`);
    if (row.entity === "client_file" && detail.reason) parts.push(detail.reason);
    if (row.entity === "invitation") { parts.length = 0; parts.push(`${detail.name} (${detail.email})`, detail.company ? `${detail.role} at ${detail.company}` : `${detail.role} at the practice`); }
    if (row.entity === "year_end") { parts.length = 0; parts.push(`Year to ${day(detail.period_end)}`, ...(Array.isArray(detail.changes) ? detail.changes : [])); }
    return parts.filter(Boolean).join(" · ");
  }
  if (row.action === "checked") {
    const answer = detail.error ? "no answer from the register" : detail.valid ? "valid" : "not valid";
    return [`${detail.number}: ${answer}`, detail.name, detail.consultation ? `consultation ${detail.consultation}` : null, detail.source === "demo" ? "demo answer" : null].filter(Boolean).join(" · ");
  }
  const text = String(detail.narration ?? detail.file ?? "");
  return detail.date && row.action !== "matched" ? `${text}${text ? " · " : ""}dated ${day(detail.date)}` : text;
}

/**
 * Every posting, match, lock and filing, in order. Each row's hash covers the
 * row before it, so a change made directly in the database — to any row —
 * breaks the chain from that point on, and the check below says where.
 */
export default async function AuditPage() {
  const org = await requireOrg();
  const head = "text-ink-faint px-3 py-2 text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase first:px-4";
  const [rows, chain] = await Promise.all([
    sql<AuditRow>(
      `select seq, at, actor, action, entity, detail, hash, prev_hash from audit_log where organisation_id = $1 order by seq desc limit ${LIMIT}`, [org.id]),
    one<{ checked: number; broken_at: number | null }>("select * from audit_verify()"),
  ]);
  return <PageBody className="space-y-4">
    <RecordHeader title="Audit trail" description="Tamper-evident: every row is chained to the one before it by a SHA-256 hash." />
    <AccountsNav current="/accounts/audit" />
    <section className={`ll-panel flex flex-wrap items-center gap-3 px-4 py-3 ${chain?.broken_at ? "border-critical-line bg-critical-soft" : ""}`}>
      {chain?.broken_at ? <ShieldAlert className="text-critical size-5" /> : <CheckCircle2 className="text-positive size-5" />}
      <div>
        <p className="text-ink text-[14px] font-semibold">{chain?.broken_at ? `The chain is broken at entry ${chain.broken_at}` : "The chain is intact"}</p>
        <p className="text-ink-muted text-[12.5px]">{formatNumber(chain?.checked ?? 0)} entries across the practice recomputed just now. {chain?.broken_at ? "A row was changed outside Ledgerline." : "Nothing has been changed, added or removed behind the app’s back."}</p>
      </div>
    </section>
    <Panel className="overflow-x-auto">
      {rows.length ? <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Entry</th><th scope="col" className={head}>When</th><th scope="col" className={head}>What happened</th>
          <th scope="col" className={head}>By</th><th scope="col" className={cn(head, "hidden md:table-cell")}>Hash</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.seq} className="align-top">
          <td className="text-ink-faint w-16 px-4 py-2.5 font-mono text-[11.5px] tabular-nums">#{row.seq}</td>
          <td className="text-ink-muted w-36 px-3 py-2.5 whitespace-nowrap tabular-nums">{formatDateTime(row.at)}</td>
          <td className="px-3 py-2.5"><span className="text-ink font-medium">{headline(row)}</span><span className="text-ink-muted block text-[12.5px]">{describe(row)}</span></td>
          <td className="text-ink-muted px-3 py-2.5 whitespace-nowrap">{row.actor === "system" ? "Ledgerline" : row.actor}</td>
          <td className="text-ink-faint hidden px-4 py-2.5 font-mono text-[11px] md:table-cell" title={row.hash}>{row.hash.slice(0, 12)}…</td>
        </tr>)}</tbody>
      </table> : <p className="text-ink-muted px-4 py-4 text-[13px]">Nothing recorded yet. Post a bill, match a bank line or file a VAT return and it appears here.</p>}
      {rows.length === LIMIT ? <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12.5px]">The latest {LIMIT} entries. The check above covers every one.</p> : null}
    </Panel>
  </PageBody>;
}
