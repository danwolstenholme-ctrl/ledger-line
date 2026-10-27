import type { Metadata } from "next";

import { getOwners, type OwnerRow } from "@/lib/data/people";
import { formatDate } from "@/lib/format";
import { getCurrentUser, getPractice, requirePracticeMember } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { ListSearch, clientMatches } from "@/components/common/list-search";
import { OwnerInvites, type OwnerLine } from "@/components/people/owner-invites";
import { RecordEmpty, RecordFilterLinks, RecordHeader, RecordPagination, RecordSection } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Owners" };

const PAGE_SIZE = 100;
const VIEWS = ["todo", "invited", "joined", "all"] as const;
type View = (typeof VIEWS)[number];

const statusOf = (row: OwnerRow): OwnerLine["status"] => row.joined_at ? "joined" : row.invited_at ? (row.expired ? "expired" : "invited") : "todo";
const day = (at: string | null) => at ? formatDate(at.slice(0, 10)) : "";

/**
 * Each client company's owner on Ledgerline: who has joined, who has a link
 * waiting, and who is still to invite, many at a time. Ledgerline sends
 * nothing itself: the practice sends the links from its own email.
 */
export default async function OwnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePracticeMember();
  const [practice, user, query] = await Promise.all([getPractice(), getCurrentUser(), searchParams]);
  const owners = await getOwners(practice.id);
  const lines = owners.map(row => ({ row, status: statusOf(row) }));
  const counts: Record<View, number> = {
    todo: lines.filter(line => line.status === "todo" || line.status === "expired").length,
    invited: lines.filter(line => line.status === "invited").length,
    joined: lines.filter(line => line.status === "joined").length,
    all: lines.length,
  };
  const view: View = VIEWS.includes(query.view as View) ? query.view as View : counts.todo ? "todo" : "all";
  const inView = (status: OwnerLine["status"]) => view === "all" || (view === "todo" ? status === "todo" || status === "expired" : status === view);
  const matching = lines.filter(line => inView(line.status) && clientMatches(query.q ?? "", { name: line.row.name, he: line.row.he_number, vat: line.row.vat_number }));
  const page = Math.max(1, Math.min(Number(query.page) || 1, Math.ceil(matching.length / PAGE_SIZE) || 1));
  const shown: OwnerLine[] = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ row, status }) => ({
    id: row.id, name: row.name, he: [row.he_number, row.manager].filter(Boolean).join(" · ") || null, contact: row.contact_name, email: row.contact_email, fileId: row.file_id, status,
    detail: status === "joined" ? `${row.owner_name ?? "Joined"} · since ${day(row.joined_at)}`
      : status === "invited" ? `Sent ${day(row.invited_at)} · link until ${day(row.expires_at)}`
      : status === "expired" ? `Sent ${day(row.invited_at)} · expired ${day(row.expires_at)}` : "",
  }));
  const here = (next: View) => `/clients/owners?view=${next}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`;
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader back={{ href: "/clients", label: "Client files" }} title="Owners on Ledgerline"
      description="Each client’s owner sees their own company in Ledgerline: where the business stands, their invoices, and the receipts they send you. Nothing of yours, and no other client." />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <RecordFilterLinks label="Owners" options={[
        { label: `To invite · ${counts.todo}`, href: here("todo"), active: view === "todo" },
        { label: `Invited · ${counts.invited}`, href: here("invited"), active: view === "invited" },
        { label: `On Ledgerline · ${counts.joined}`, href: here("joined"), active: view === "joined" },
        { label: `All · ${counts.all}`, href: here("all"), active: view === "all" },
      ]} />
      {counts.all > 20 ? <ListSearch action="/clients/owners" value={query.q} keep={{ view }} placeholder="Find a client: name, HE or VAT number" /> : null}
    </div>
    <RecordSection title={view === "todo" ? "To invite" : view === "invited" ? "Invited, not joined yet" : view === "joined" ? "On Ledgerline" : "Every client"}
      hint={`${counts.joined} of ${counts.all} owners on Ledgerline${counts.invited ? ` · ${counts.invited} with a link waiting` : ""}`}>
      {shown.length ? <>
        <OwnerInvites key={`${view}:${page}:${query.q ?? ""}`} rows={shown} practice={practice.name} from={`${user.name}\n${practice.name}`} choose={view === "todo"} />
        {matching.length > PAGE_SIZE ? <RecordPagination page={page} total={matching.length} pageSize={PAGE_SIZE} href={here(view)} /> : null}
      </> : <RecordEmpty title={!counts.all ? "No clients yet" : query.q ? "No client matches" : view === "todo" ? "Everyone is invited" : "Nobody here"}>
        {!counts.all ? "Bring your client list over, or take a client on: their owners are invited from here."
          : query.q ? "Try part of the name, or the HE or VAT number." : view === "todo" ? "Every client’s owner has joined, or has a link waiting." : "Owners appear here as they are invited and join."}</RecordEmpty>}
    </RecordSection>
  </PageBody>;
}
