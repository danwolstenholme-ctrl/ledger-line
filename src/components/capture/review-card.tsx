"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, ChevronDown, Eye, TriangleAlert } from "lucide-react";

import { discardCaptureItem, postCaptureItem, routeCaptureItem } from "@/lib/actions/capture";
import { idleState } from "@/lib/actions/state";
import type { PickerAccount } from "@/lib/domain/accounts";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, FormError, InlineSubmit, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { LineEditor } from "@/components/accounts/line-editor";
import { RecordBadge } from "@/components/records/record-layout";

export type ReviewItem = {
  id: string; fileId: string; fileName: string; mediaType: string; pages: string; language: string;
  supplier: { name: string; name_latin: string; vat_number: string | null; country: string };
  billedTo: string | null; billedToVat: string | null; number: string | null; issueDate: string | null; dueDate: string | null;
  totals: { net: number; vat: number; total: number }; warnings: string[]; photo: boolean;
  organisationId: string | null; routing: { method: string; confidence: string };
  checks: { key: string; ok: boolean; label: string; detail: string }[];
  draft: { supplier_id: string | null; new_supplier: string | null; supplier_match: string; reverse_charge: boolean; lines: { description: string; account_id: string; net: number; vat_rate: number; vat_amount: number }[] } | null;
};
export type ReviewClient = { id: string; name: string; slug: string; accounts: PickerAccount[]; suppliers: { id: string; name: string }[] };

const ROUTED = { vat_number: "Matched on the customer's VAT number", name: "Matched on the customer's name", uploaded: "Uploaded in this company", manual: "Chosen by you", none: "No client matched" } as Record<string, string>;
const SUPPLIER = { vat_number: "existing supplier, matched on VAT number", name: "existing supplier, matched on name", new: "new supplier, added with the bill" } as Record<string, string>;

export function ReviewCard({ item, clients }: { item: ReviewItem; clients: ReviewClient[] }) {
  const [state, action] = useActionState(postCaptureItem, idleState);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const client = clients.find(entry => entry.id === item.organisationId) ?? null;
  const failing = item.checks.filter(check => !check.ok);
  const greek = item.language !== "en" && item.supplier.name !== item.supplier.name_latin;
  return <li className="ll-panel overflow-hidden">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-72">
        <p className="text-ink truncate text-[13.5px] font-semibold">{item.supplier.name_latin}{greek ? <span className="text-ink-faint ml-2 text-[12px] font-normal">{item.supplier.name}</span> : null}</p>
        <p className="text-ink-faint truncate text-[11.5px]">{item.fileName}{item.pages ? ` · page ${item.pages}` : ""} · {item.language === "el" ? "Greek" : item.language === "mixed" ? "Greek and English" : "English"}{item.photo ? " · photo" : ""}{item.number ? ` · No. ${item.number}` : ""}{item.issueDate ? ` · ${formatDate(item.issueDate)}` : ""}</p>
      </div>
      <div className="text-right"><p className="text-ink text-[14px] font-semibold tabular-nums">{formatAmount(item.totals.total)}</p><p className="text-ink-faint text-[11px] tabular-nums">{formatAmount(item.totals.net)} + {formatAmount(item.totals.vat)} VAT</p></div>
      <div className="min-w-48">
        <p className={cn("text-[12.5px] font-medium", client ? "text-ink" : "text-caution")}>{client ? `→ ${client.name}` : "Which client?"}</p>
        <p className="text-ink-faint text-[11px]">{ROUTED[item.routing.method] ?? ROUTED.none}</p>
      </div>
      <RecordBadge tone={failing.length ? "caution" : "positive"}>
        {failing.length ? <TriangleAlert className="mr-1 size-3" /> : <CheckCircle2 className="mr-1 size-3" />}{failing.length ? `${failing.length} to check` : "All checks pass"}
      </RecordBadge>
      <button type="button" onClick={() => setOpen(value => !value)} className="border-hairline-strong text-ink hover:bg-muted inline-flex h-8 items-center gap-1 rounded-md border px-3 text-[12.5px] font-medium" aria-expanded={open}>
        Review<ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
    </div>
    {open ? <div className="border-hairline grid gap-4 border-t p-4 xl:grid-cols-[21rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <ul className="divide-hairline border-hairline divide-y rounded-md border">{item.checks.map(check => <li key={check.key} className="flex items-start gap-2 px-3 py-1.5 text-[12.5px]">
          {check.ok ? <CheckCircle2 className="text-positive mt-0.5 size-3.5 shrink-0" /> : <TriangleAlert className="text-caution mt-0.5 size-3.5 shrink-0" />}
          <span className="min-w-0"><span className="text-ink">{check.label}</span><span className="text-ink-faint block text-[11.5px]">{check.detail}</span></span>
        </li>)}</ul>
        {item.warnings.length ? <ul className="text-caution space-y-1 text-[12px]">{item.warnings.map(warning => <li key={warning}>Claude: {warning}</li>)}</ul> : null}
        <dl className="text-[12px]">
          <div className="flex gap-2 py-0.5"><dt className="text-ink-muted w-28 shrink-0">Billed to</dt><dd className="text-ink">{item.billedTo ?? "—"}{item.billedToVat ? ` · ${item.billedToVat}` : ""}</dd></div>
          <div className="flex gap-2 py-0.5"><dt className="text-ink-muted w-28 shrink-0">Supplier VAT</dt><dd className="text-ink font-mono">{item.supplier.vat_number ?? "—"} <span className="font-sans text-ink-faint">{item.supplier.country}</span></dd></div>
        </dl>
        <form action={routeCaptureItem} className="flex items-end gap-2">
          <input type="hidden" name="item_id" value={item.id} />
          <label className="min-w-0 flex-1 space-y-1 text-[11.5px]"><span className="text-ink-muted block">Client</span>
            <NativeSelect name="organisation_id" defaultValue={item.organisationId ?? ""} aria-label="Client">
              <option value="">Choose the client…</option>
              {clients.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </NativeSelect></label>
          <InlineSubmit className="border-hairline-strong text-ink h-8 rounded-md border px-2.5 text-[12px]">Move here</InlineSubmit>
        </form>
        <button type="button" onClick={() => setPreview(value => !value)} className="text-brand inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"><Eye className="size-3.5" />{preview ? "Hide the document" : "Show the document"}</button>
        {preview ? item.mediaType === "application/pdf"
          ? <iframe title={item.fileName} src={`/api/capture/files/${item.fileId}#page=${item.pages.split("-")[0] || 1}`} className="border-hairline h-[480px] w-full rounded-md border" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img alt={item.fileName} src={`/api/capture/files/${item.fileId}`} className="border-hairline max-h-[520px] w-full rounded-md border object-contain" /> : null}
      </div>
      {client && item.draft ? <form action={action} className="space-y-3">
        <input type="hidden" name="item_id" value={item.id} />
        <input type="hidden" name="organisation_id" value={client.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" hint={SUPPLIER[item.draft.supplier_match]}>
            {item.draft.supplier_id ? <NativeSelect name="supplier_id" defaultValue={item.draft.supplier_id}>{client.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</NativeSelect>
              : <TextInput name="new_supplier" defaultValue={item.draft.new_supplier ?? item.supplier.name_latin} />}
          </Field>
          <Field label="Invoice number"><TextInput name="number" defaultValue={item.number ?? ""} className="font-mono" /></Field>
          <Field label="Bill date"><TextInput name="issued_on" type="date" defaultValue={item.issueDate ?? ""} /></Field>
          <Field label="Due date" hint="optional"><TextInput name="due_on" type="date" defaultValue={item.dueDate ?? ""} /></Field>
        </div>
        <LineEditor key={client.id} accounts={client.accounts} reverseCharge={item.draft.reverse_charge}
          initial={item.draft.lines.map(line => ({ description: line.description, account_id: line.account_id, net: line.net.toFixed(2), vat_rate: line.vat_rate, vat_amount: line.vat_amount.toFixed(2) }))} />
        {item.draft.reverse_charge ? <><input type="hidden" name="reverse_charge" value="on" /><p className="text-ink-muted text-[12px]">Reverse charge: a supplier in another EU state charged no VAT. The VAT goes on the return as both due and reclaimed (boxes 1, 4, 7 and 11B).</p></> : null}
        <FormError message={state.error} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Posting…">Post bill to {client.name.replace(/ (Ltd|Limited)$/, "")}</SubmitButton>
          <button formAction={discardCaptureItem} className="text-ink-muted hover:text-critical text-[12.5px]">Discard</button>
        </div>
      </form> : <p className="text-ink-muted text-[12.5px]">Choose the client this invoice belongs to, and the bill will be drafted in that client&apos;s books with its own suppliers and accounts.</p>}
    </div> : null}
  </li>;
}
