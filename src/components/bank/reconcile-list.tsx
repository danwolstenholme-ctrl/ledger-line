"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "@/components/navigation/navigation-link";
import { Brain, Check, CheckCheck, ChevronDown, X } from "lucide-react";

import { matchConfident, reconcileLine, setLineExcluded, setLinesAside, suggestWithAi, unmatchLine } from "@/lib/actions/bank";
import { idleState, type ActionState } from "@/lib/actions/state";
import { type PickerAccount } from "@/lib/domain/accounts";
import type { AiSuggestionState, OpenBill, OpenInvoice, Suggestion } from "@/lib/domain/bank-statements";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormError, InlineSubmit, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { AccountOptions } from "@/components/accounts/line-editor";
import type { BankLineStatus, BankMatchItem } from "@/types/database";
import { useCurrency, useRegime } from "@/components/common/regime";

export type ReconcileLine = {
  id: string; txn_date: string; amount: number; description: string; reference: string | null; counterparty: string | null;
  status: BankLineStatus; matched_amount: number; excluded_reason: string | null;
};
export type RecordedItem = { kind: "invoice_payment" | "bill_payment" | "bank_transaction"; id: string; item_date: string; amount: number; label: string; reference: string | null };
export type MatchedDocumentView = { label: string; href: string | null; amount: number };

type Candidates = {
  invoices: OpenInvoice[]; bills: OpenBill[]; recorded: RecordedItem[];
  banks: { id: string; code: string; name: string }[]; accounts: PickerAccount[]; bankFeesAccountId: string | null;
};

const cents = (value: number) => Math.round(value * 100);
const toNumber = (text: string) => { const value = Number(text.replace(/[,\s€£]/g, "")); return Number.isFinite(value) ? value : NaN; };
const signed = (amount: number, currency: string) => `${amount < 0 ? "−" : ""}${formatAmount(Math.abs(amount), currency)}`;
const CONFIDENCE = { high: "Sure", medium: "Likely", low: "Possible" } as const;
/** The rules' suggestions first, then the AI's, leaving out any the rules already made. */
const withAi = (rules: Suggestion[], ai: Suggestion[]) => [...rules, ...ai.filter(item => !rules.some(rule => JSON.stringify(rule.items) === JSON.stringify(item.items)))];

/** Submit a set of match items for one line. */
function MatchButton({ lineId, items, label = "Match", disabled = false, variant = "primary" }: { lineId: string; items: BankMatchItem[]; label?: string; disabled?: boolean; variant?: "primary" | "outline" }) {
  const [state, action] = useActionState(reconcileLine, idleState);
  return <form action={action} className="inline-flex flex-col gap-1">
    <input type="hidden" name="line_id" value={lineId} />
    <input type="hidden" name="items" value={JSON.stringify(items)} />
    <SubmitButton size="sm" variant={variant} pendingLabel="Matching…" disabled={disabled}><Check className="size-3.5" />{label}</SubmitButton>
    <FormError message={state.error} />
  </form>;
}

/*
 * The statement as a ledger: one row a line, its columns lined up down the
 * page. Wide, a row reads date, description, account or match, VAT, amount,
 * action. Narrower, the controls drop to a second row under the description;
 * on a phone the description gets a row of its own. The list measures its own
 * width (a container query), so an open sidebar never squeezes the columns.
 */
const ROW = [
  "grid gap-x-3 gap-y-1 px-4 py-2",
  "grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] [grid-template-areas:'check_date_date_amount'_'._desc_desc_desc'_'._code_vat_act']",
  "@min-[40rem]:grid-cols-[1.25rem_5rem_minmax(0,1fr)_5.5rem_7.5rem] @min-[40rem]:[grid-template-areas:'check_date_desc_desc_amount'_'._._code_vat_act']",
  "@min-[60rem]:grid-cols-[1.25rem_5rem_minmax(0,1fr)_14rem_5.5rem_7rem_7.5rem] @min-[60rem]:[grid-template-areas:'check_date_desc_code_vat_amount_act'] @min-[60rem]:py-1.5",
].join(" ");
/** The column headings, shown only where every column has a place in one row. */
const HEAD = "hidden gap-x-3 px-4 @min-[60rem]:grid @min-[60rem]:grid-cols-[1.25rem_5rem_minmax(0,1fr)_14rem_5.5rem_7rem_7.5rem] @min-[60rem]:[grid-template-areas:'check_date_desc_code_vat_amount_act']";
const HEADING = "text-ink-faint text-[10.5px] font-semibold tracking-[0.06em] uppercase";
/** What spans the account and VAT columns: a suggestion, a match, a reason. */
const WIDE = "[grid-area:code-start/code-start/code-end/vat-end] min-w-0 self-center";
/** A quiet select: a hairline until it is hovered or focused, so a page of them reads as a table rather than a form. */
const QUIET = "border-hairline hover:border-hairline-strong h-7 bg-transparent pl-2 pr-6 text-[12.5px] hover:bg-surface touch:h-10";

/**
 * The lines of one bank account still to match, each with what it most likely
 * was. Confident suggestions can all be accepted at once; anything else is
 * matched, coded or set aside line by line, or many at a time.
 */
export function ReconcileList({ view, lines, suggestions, documents, candidates, ai }: {
  view: "to_match" | "matched" | "set_aside";
  lines: ReconcileLine[];
  suggestions: Record<string, Suggestion[]>;
  documents: Record<string, MatchedDocumentView[]>;
  candidates: Candidates;
  /** Whether lines can be put to the AI service, or why not when an administrator has asked for it. */
  ai: { available: boolean; note: string | null };
}) {
  const confident = lines.filter(line => line.status === "unmatched" && suggestions[line.id]?.[0]?.confidence === "high");
  const [state, action] = useActionState(matchConfident, idleState);
  const unsure = lines.filter(line => line.status === "unmatched" && suggestions[line.id]?.[0]?.confidence !== "high").slice(0, 30);
  const [asked, ask, asking] = useActionState(suggestWithAi, { ok: false, error: null } as AiSuggestionState);
  const fromAi = asked.suggestions ?? {};
  const selectable = view === "to_match" ? lines.filter(line => line.status === "unmatched") : [];
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = selectable.filter(line => selected.includes(line.id));
  const toggle = (id: string, on: boolean) => setSelected(current => on ? [...current, id] : current.filter(item => item !== id));
  const askable = view === "to_match" && ai.available && unsure.length > 0;
  return <div className="@container">
    {view === "to_match" && (confident.length || askable || ai.note) ? <div className="border-hairline flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2 text-[12.5px]">
      {confident.length ? <form action={action} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <input type="hidden" name="matches" value={JSON.stringify(confident.map(line => ({ line_id: line.id, items: suggestions[line.id][0].items })))} />
        <CheckCheck aria-hidden className="text-positive size-4 shrink-0" />
        <span className="text-ink font-medium">{confident.length} line{confident.length === 1 ? " has" : "s have"} a sure match</span>
        <span className="text-ink-faint hidden xl:inline">the bank names the invoice or bill and the amount agrees, or it was recorded already</span>
        <SubmitButton size="sm" pendingLabel="Matching…">Match {confident.length === 1 ? "it" : `all ${confident.length}`}</SubmitButton>
      </form> : null}
      {askable ? <form action={ask} className="ml-auto flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <input type="hidden" name="line_ids" value={JSON.stringify(unsure.map(line => line.id))} />
        <span className="text-ink-muted">{asked.suggestions ? `AI suggested ${Object.keys(fromAi).length} of ${unsure.length}. Check each before matching.`
          : `${unsure.length} line${unsure.length === 1 ? "" : "s"} with no sure match`}</span>
        <SubmitButton size="sm" variant="outline" pendingLabel="Asking AI…"><Brain className="size-3.5" />{asked.suggestions ? "Ask again" : "Ask AI"}</SubmitButton>
      </form> : view === "to_match" && ai.note ? <p className="text-ink-faint ml-auto text-[12px]">{ai.note}</p> : null}
      {state.error ? <p role="alert" className="text-critical w-full text-[12px]">{state.error}</p> : null}
      {asked.error && !asking ? <p role="alert" className="text-critical w-full text-[12px]">{asked.error}</p> : null}
    </div> : null}
    {selectable.length ? <BulkBar lines={selectable} chosen={chosen} suggestions={suggestions} accounts={candidates.accounts}
      onSelectAll={on => setSelected(on ? selectable.map(line => line.id) : [])} onDone={() => setSelected([])} />
      : <div className={cn(HEAD, "border-hairline bg-surface-sunken border-b py-1.5")} aria-hidden>
        <span className={cn(HEADING, "[grid-area:date]")}>Date</span>
        <span className={cn(HEADING, "[grid-area:desc]")}>Description</span>
        <span className={cn(HEADING, WIDE)}>{view === "matched" ? "Matched to" : view === "set_aside" ? "Why it is not for the books" : "Account or match"}</span>
        <span className={cn(HEADING, "[grid-area:amount] text-right")}>Amount</span>
      </div>}
    <ul className="divide-hairline divide-y">
      {lines.map(line => <li key={line.id} className={cn(selected.includes(line.id) && "bg-brand-50")}>
        {view === "to_match" ? <LineToMatch line={line} suggestions={withAi(suggestions[line.id] ?? [], line.status === "unmatched" ? fromAi[line.id] ?? [] : [])} candidates={candidates}
            selected={selected.includes(line.id)} onSelect={line.status === "unmatched" ? on => toggle(line.id, on) : undefined} />
          : view === "matched" ? <MatchedLine line={line} documents={documents[line.id] ?? []} />
          : <SetAsideLine line={line} />}
      </li>)}
    </ul>
  </div>;
}

/** The date, the bank's words and the amount: the three cells every row shares. */
function LineCells({ line }: { line: ReconcileLine }) {
  const currency = useCurrency();
  const detail = [line.counterparty, line.reference].filter(Boolean).join(" · ");
  return <>
    <span className="text-ink-muted [grid-area:date] self-center text-[12px] whitespace-nowrap tabular-nums">{formatDate(line.txn_date)}</span>
    <span className="[grid-area:desc] min-w-0 self-center" title={line.description}>
      <span className="text-ink block text-[13px] break-words @min-[40rem]:truncate">{line.description}</span>
      {detail ? <span className="text-ink-faint block truncate text-[11.5px]">{detail}</span> : null}
    </span>
    <span className={cn("[grid-area:amount] self-center text-right text-[13px] font-medium whitespace-nowrap tabular-nums", line.amount > 0 ? "text-positive" : "text-ink")}>{signed(line.amount, currency)}</span>
  </>;
}

/** How sure a suggestion is, and whether the AI made it. */
function Confidence({ suggestion }: { suggestion: Suggestion }) {
  return <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.05em] uppercase",
    suggestion.confidence === "high" ? "bg-positive-soft text-positive" : "bg-muted text-ink-muted")}>{suggestion.source === "ai" ? "AI · " : ""}{CONFIDENCE[suggestion.confidence]}</span>;
}

/**
 * One line to match, as a row. With a suggestion, the row shows it and Match
 * takes it. Without one, the row is coded where it stands: the account, the
 * VAT inside the amount, and Match once an account is chosen. Everything else
 * (bills or invoices, payments already recorded, a transfer, setting it
 * aside) opens beneath the row.
 */
function LineToMatch({ line, suggestions, candidates, selected, onSelect }: {
  line: ReconcileLine; suggestions: Suggestion[]; candidates: Candidates; selected: boolean; onSelect?: (on: boolean) => void;
}) {
  const { vatRates } = useRegime();
  const currency = useCurrency();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [rate, setRate] = useState(0);
  const [state, action] = useActionState(reconcileLine, idleState);
  const [top, ...others] = suggestions;
  const moneyIn = line.amount > 0;
  const check = <span className="[grid-area:check] self-center leading-none">
    {onSelect ? <input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} aria-label={`Select ${line.description}`} className="accent-brand size-4 cursor-pointer touch:size-5" /> : null}
  </span>;

  if (line.status === "partial") return <div className={ROW}>
    {check}<LineCells line={line} />
    <p className={cn(WIDE, "text-caution text-[12px]")}>Partly matched: {signed(line.matched_amount, currency)} of {signed(line.amount, currency)} is explained, because something it was matched to has changed.</p>
    <form action={unmatchLine} className="[grid-area:act] flex justify-end self-center"><input type="hidden" name="line_id" value={line.id} /><InlineSubmit>Unmatch</InlineSubmit></form>
  </div>;

  const items = top ? top.items : account ? codedItems(line, account, rate) : null;
  return <>
    <form action={action} className={ROW}>
      <input type="hidden" name="line_id" value={line.id} />
      <input type="hidden" name="items" value={JSON.stringify(items ?? [])} />
      {check}<LineCells line={line} />
      {top ? <div className={WIDE} title={top.reason}>
        <span className="flex min-w-0 items-center gap-2"><Confidence suggestion={top} /><span className="text-ink min-w-0 truncate text-[12.5px] font-medium">{top.label}</span></span>
        <span className="text-ink-faint block truncate text-[11.5px]">{top.reason}{others.length ? ` · ${others.length} more under the arrow` : ""}</span>
      </div> : <>
        <div className="[grid-area:code] min-w-0 self-center">
          <NativeSelect aria-label={moneyIn ? "Money in for" : "Spent on"} value={account} onChange={event => setAccount(event.target.value)} className={cn(QUIET, !account && "text-ink-faint")}>
            <AccountOptions accounts={candidates.accounts} placeholder={moneyIn ? "Money in for…" : "Spent on…"} />
          </NativeSelect>
        </div>
        <div className="[grid-area:vat] min-w-0 self-center">
          <NativeSelect aria-label="VAT rate" value={String(rate)} onChange={event => setRate(Number(event.target.value))} className={cn(QUIET, !rate && "text-ink-muted")}>
            {vatRates.map(value => <option key={value} value={value}>{value}% VAT</option>)}
          </NativeSelect>
        </div>
      </>}
      <div className="[grid-area:act] flex items-center justify-end gap-1 self-center">
        {items ? <SubmitButton size="sm" pendingLabel="Matching…"><Check className="size-3.5" />Match</SubmitButton> : null}
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="More ways to match"
          title={moneyIn ? "An invoice, a payment already recorded, a transfer, or set it aside" : "A bill, a payment already recorded, a transfer, or set it aside"}
          className={cn("text-ink-muted hover:bg-muted hover:text-ink focus-visible:ring-ring/40 grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-[3px] touch:size-10", open && "bg-muted text-ink")}>
          <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </div>
      {state.error ? <p role="alert" className="text-critical [grid-column:2/-1] text-[12px]">{state.error}</p> : null}
    </form>
    {open ? <LineOptions line={line} candidates={candidates} others={others} /> : null}
  </>;
}

type OptionTab = "suggested" | "documents" | "recorded" | "code" | "transfer" | "aside";

function LineOptions({ line, candidates, others }: { line: ReconcileLine; candidates: Candidates; others: Suggestion[] }) {
  const moneyIn = line.amount > 0;
  const tabs: { key: OptionTab; label: string }[] = [
    ...(others.length ? [{ key: "suggested" as const, label: `Other suggestions · ${others.length}` }] : []),
    { key: "documents", label: moneyIn ? "Invoices" : "Bills" },
    { key: "recorded", label: "Already recorded" },
    { key: "code", label: moneyIn ? "Code as money received" : "Code as money spent" },
    ...(candidates.banks.length ? [{ key: "transfer" as const, label: "Transfer" }] : []),
    { key: "aside", label: "Set aside" },
  ];
  const [tab, setTab] = useState<OptionTab>(others.length ? "suggested" : "documents");
  return <div className="border-hairline bg-surface-sunken space-y-3 border-t px-4 py-3 pl-12 @min-[40rem]:pl-[8.75rem]">
    <div role="tablist" aria-label="Ways to match this line" className="bg-muted inline-flex max-w-full flex-wrap gap-0.5 rounded-md p-0.5">
      {tabs.map(item => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
        className={cn("rounded px-2.5 py-1 text-[12px] transition-colors touch:min-h-10 touch:px-3.5", tab === item.key ? "bg-surface text-ink font-medium shadow-xs" : "text-ink-muted hover:text-ink")}>{item.label}</button>)}
    </div>
    {tab === "suggested" ? <ul className="divide-hairline border-hairline bg-surface divide-y rounded-md border">{others.map((suggestion, index) => <li key={index} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[12.5px]">
        <Confidence suggestion={suggestion} />
        <span className="min-w-0 flex-1"><span className="text-ink">{suggestion.label}</span><span className="text-ink-faint"> · {suggestion.reason}</span></span>
        <MatchButton lineId={line.id} items={suggestion.items} label="Use this" variant="outline" />
      </li>)}</ul>
      : tab === "documents" ? <DocumentPicker line={line} candidates={candidates} />
      : tab === "recorded" ? <RecordedPicker line={line} recorded={candidates.recorded} />
      : tab === "code" ? <CodeIt line={line} accounts={candidates.accounts} />
      : tab === "transfer" ? <TransferTo line={line} banks={candidates.banks} />
      : <SetAside line={line} />}
  </div>;
}

/** Choose one or more invoices (money in) or bills (money out), with how much of the line goes to each. */
function DocumentPicker({ line, candidates }: { line: ReconcileLine; candidates: Candidates }) {
  const currency = useCurrency();
  const uid = useId();
  const moneyIn = line.amount > 0;
  const documents = useMemo(() => (moneyIn
    ? candidates.invoices.map(invoice => ({ id: invoice.id, number: invoice.number, name: invoice.client, balance: invoice.balance }))
    : candidates.bills.map(bill => ({ id: bill.id, number: bill.number ?? "No number", name: bill.supplier, balance: bill.balance }))), [moneyIn, candidates]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ id: string; label: string; balance: number; amount: string }[]>([]);
  const [charges, setCharges] = useState(false);
  const target = cents(Math.abs(line.amount));
  const total = chosen.reduce((sum, item) => sum + cents(toNumber(item.amount) || 0), 0);
  const shown = documents.filter(doc => !chosen.some(item => item.id === doc.id) && (!query || `${doc.number} ${doc.name}`.toLowerCase().includes(query.toLowerCase()))).slice(0, 8);
  const short = moneyIn && total > target ? total - target : 0;
  const canCharge = short > 0 && Boolean(candidates.bankFeesAccountId);
  const valid = chosen.length > 0 && chosen.every(item => cents(toNumber(item.amount)) > 0 && cents(toNumber(item.amount)) <= cents(item.balance))
    && (total === target || (charges && canCharge && total - short === target));
  const items: BankMatchItem[] = [
    ...chosen.map(item => moneyIn
      ? { kind: "invoice" as const, invoice_id: item.id, amount: cents(toNumber(item.amount)) / 100 }
      : { kind: "bill" as const, bill_id: item.id, amount: cents(toNumber(item.amount)) / 100 }),
    ...(charges && canCharge ? [{ kind: "spend" as const, contact: null, lines: [{ description: "Bank charges deducted from a payment", account_id: candidates.bankFeesAccountId!, net: short / 100, vat_rate: 0, vat_amount: 0 }] }] : []),
  ];
  const add = (doc: (typeof documents)[number]) => {
    const remaining = Math.max(0, target - total);
    setChosen(current => [...current, { id: doc.id, label: `${doc.number} · ${doc.name}`, balance: doc.balance, amount: ((remaining ? Math.min(remaining, cents(doc.balance)) : cents(doc.balance)) / 100).toFixed(2) }]);
  };
  return <div className="space-y-3">
    <TextInput aria-label={moneyIn ? "Search open invoices" : "Search open bills"} placeholder={moneyIn ? "Search invoice number or client" : "Search bill number or supplier"} value={query} onChange={event => setQuery(event.target.value)} />
    {shown.length ? <ul className="divide-hairline border-hairline bg-surface divide-y rounded-md border">{shown.map(doc => <li key={doc.id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate"><span className="text-ink font-mono text-[12px]">{doc.number}</span> <span className="text-ink-muted">· {doc.name}</span></span>
      <span className="text-ink-muted tabular-nums">{formatAmount(doc.balance, currency)} owed</span>
      <button type="button" onClick={() => add(doc)} className="text-brand text-[12px] font-medium hover:underline touch:min-h-10">Add</button>
    </li>)}</ul> : <p className="text-ink-faint text-[12px]">{documents.length ? "Nothing else matches that search." : moneyIn ? "No invoices are open." : "No bills are open."}</p>}
    {chosen.length ? <div className="space-y-1.5">
      {chosen.map((item, index) => <div key={item.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-ink min-w-0 flex-1 truncate">{item.label}</span>
        <label htmlFor={`${uid}-${index}`} className="sr-only">Amount for {item.label}</label>
        <TextInput id={`${uid}-${index}`} inputMode="decimal" value={item.amount} className="w-28 text-right tabular-nums"
          onChange={event => setChosen(current => current.map(entry => entry.id === item.id ? { ...entry, amount: event.target.value } : entry))} />
        <button type="button" aria-label={`Remove ${item.label}`} onClick={() => setChosen(current => current.filter(entry => entry.id !== item.id))} className="text-ink-faint hover:text-critical grid size-8 place-items-center touch:size-10"><X className="size-3.5" /></button>
      </div>)}
      <p className={cn("text-[12px] tabular-nums", total === target ? "text-positive" : "text-ink-muted")}>Chosen {formatAmount(total / 100, currency)} of {formatAmount(target / 100, currency)}{total < target ? ` · ${formatAmount((target - total) / 100, currency)} still to place` : ""}</p>
      {total > target ? null : <p className="text-ink-faint text-[11.5px]">{moneyIn ? "A part payment is fine: an invoice can take less than it owes, and one payment can cover several invoices." : "A part payment is fine: a bill can take less than it owes, and one payment can cover several bills."}</p>}
      {canCharge ? <label className="text-ink flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={charges} onChange={event => setCharges(event.target.checked)} className="size-4" />
        Record the {formatAmount(short / 100, currency)} difference as bank charges taken from the payment</label> : null}
    </div> : null}
    {chosen.length ? <MatchButton lineId={line.id} items={items} disabled={!valid} /> : null}
  </div>;
}

/** Match payments or bank entries recorded earlier and not yet on a statement. */
function RecordedPicker({ line, recorded }: { line: ReconcileLine; recorded: RecordedItem[] }) {
  const currency = useCurrency();
  const sameWay = recorded.filter(item => (item.amount > 0) === (line.amount > 0));
  const [chosen, setChosen] = useState<string[]>([]);
  const total = sameWay.filter(item => chosen.includes(item.id)).reduce((sum, item) => sum + cents(item.amount), 0);
  const items = sameWay.filter(item => chosen.includes(item.id)).map(item => ({ kind: item.kind, id: item.id }));
  if (!sameWay.length) return <p className="text-ink-faint text-[12px]">Nothing recorded {line.amount > 0 ? "coming into" : "going out of"} this account is waiting for a statement line.</p>;
  return <div className="space-y-3">
    <ul className="divide-hairline border-hairline bg-surface divide-y rounded-md border">{sameWay.map(item => <li key={`${item.kind}-${item.id}`}>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-[12.5px] touch:min-h-11">
        <input type="checkbox" className="size-4" checked={chosen.includes(item.id)} onChange={event => setChosen(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
        <span className="text-ink-muted w-[5.5rem] shrink-0 tabular-nums">{formatDate(item.item_date)}</span>
        <span className="text-ink min-w-0 flex-1 truncate">{item.label}{item.reference ? <span className="text-ink-faint"> · {item.reference}</span> : null}</span>
        <span className="tabular-nums">{signed(item.amount, currency)}</span>
      </label>
    </li>)}</ul>
    <p className={cn("text-[12px] tabular-nums", total === cents(line.amount) ? "text-positive" : "text-ink-muted")}>Chosen {signed(total / 100, currency)} of {signed(line.amount, currency)}</p>
    {items.length ? <MatchButton lineId={line.id} items={items} disabled={total !== cents(line.amount)} /> : null}
  </div>;
}

/** The line coded to an account, VAT inside the amount. */
function codedItems(line: ReconcileLine, account: string, rate: number, description = line.description): BankMatchItem[] {
  const gross = cents(Math.abs(line.amount)), net = Math.round(gross / (1 + rate / 100));
  return [{ kind: line.amount > 0 ? "receive" : "spend", contact: line.counterparty, lines: [{ description: description.trim().slice(0, 300) || "Bank line", account_id: account, net: net / 100, vat_rate: rate, vat_amount: (gross - net) / 100 }] }];
}

/**
 * The table's header, and its bulk actions once lines are ticked: code every
 * chosen line to one account, take the suggestion each has, or set them aside.
 * Built for a statement of hundreds of lines; each line still succeeds or
 * fails on its own.
 */
function BulkBar({ lines, chosen, suggestions, accounts, onSelectAll, onDone }: {
  lines: ReconcileLine[]; chosen: ReconcileLine[]; suggestions: Record<string, Suggestion[]>; accounts: PickerAccount[];
  onSelectAll: (on: boolean) => void; onDone: () => void;
}) {
  const { vatRates } = useRegime();
  const [account, setAccount] = useState("");
  const [rate, setRate] = useState(0);
  // Done lines leave the list; the selection is cleared when the action returns, not while rendering.
  const [coded, code] = useActionState(async (previous: ActionState, form: FormData) => { const done = await matchConfident(previous, form); if (done.ok) onDone(); return done; }, idleState);
  const [aside, setAside] = useActionState(async (previous: ActionState, form: FormData) => { const done = await setLinesAside(previous, form); if (done.ok) onDone(); return done; }, idleState);
  const withSuggestion = chosen.filter(line => suggestions[line.id]?.[0]);
  const all = chosen.length === lines.length;
  const tick = (label: string) => <input type="checkbox" checked={all} aria-label={label} ref={input => { if (input) input.indeterminate = chosen.length > 0 && !all; }}
    onChange={event => onSelectAll(event.target.checked)} className="accent-brand size-4 cursor-pointer touch:size-5" />;
  return <div className="border-hairline bg-surface-sunken sticky top-12 z-10 border-b">
    {chosen.length ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-1.5">
      {tick(all ? "Clear the selection" : `Select all ${lines.length} on this page`)}
      <span className="text-ink text-[12.5px] font-medium">{chosen.length} selected</span>
      <form action={code} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="matches" value={JSON.stringify(account ? chosen.map(line => ({ line_id: line.id, items: codedItems(line, account, rate) })) : [])} />
        <NativeSelect aria-label="Code the selected lines to" value={account} onChange={event => setAccount(event.target.value)} className="h-7 w-[16rem] max-w-full text-[12.5px] touch:h-10"><AccountOptions accounts={accounts} /></NativeSelect>
        <NativeSelect aria-label="VAT rate for the selected lines" value={String(rate)} onChange={event => setRate(Number(event.target.value))} className="h-7 w-[6rem] text-[12.5px] touch:h-10">{vatRates.map(value => <option key={value} value={value}>{value}% VAT</option>)}</NativeSelect>
        <SubmitButton size="sm" pendingLabel="Coding…" disabled={!account}>Code {chosen.length === 1 ? "it" : `all ${chosen.length}`}</SubmitButton>
      </form>
      {withSuggestion.length ? <form action={code}>
        <input type="hidden" name="matches" value={JSON.stringify(withSuggestion.map(line => ({ line_id: line.id, items: suggestions[line.id][0].items })))} />
        <SubmitButton size="sm" variant="outline" pendingLabel="Matching…"><Check className="size-3.5" />Take {withSuggestion.length === 1 ? "its suggestion" : `${withSuggestion.length} suggestions`}</SubmitButton>
      </form> : null}
      <form action={setAside}>
        <input type="hidden" name="line_ids" value={JSON.stringify(chosen.map(line => line.id))} />
        <input type="hidden" name="reason" value="Set aside with others from the statement" />
        <SubmitButton size="sm" variant="outline" pendingLabel="Setting aside…">Set aside</SubmitButton>
      </form>
      <button type="button" onClick={() => onSelectAll(false)} className="text-ink-muted hover:text-ink ml-auto text-[12px] touch:min-h-10">Clear</button>
    </div> : <>
      <label className="text-ink-muted flex items-center gap-2 px-4 py-2 text-[12.5px] @min-[60rem]:hidden touch:min-h-11">{tick(`Select all ${lines.length} on this page`)}Select all {lines.length} on this page</label>
      <div className={cn(HEAD, "items-center py-1.5")}>
        <span className="[grid-area:check] leading-none">{tick(`Select all ${lines.length} on this page`)}</span>
        <span className={cn(HEADING, "[grid-area:date]")}>Date</span>
        <span className={cn(HEADING, "[grid-area:desc]")} title="Tick lines to code or set aside many at once">Description</span>
        <span className={cn(HEADING, "[grid-area:code]")}>Account or match</span>
        <span className={cn(HEADING, "[grid-area:vat]")}>VAT</span>
        <span className={cn(HEADING, "[grid-area:amount] text-right")}>Amount</span>
      </div>
    </>}
    {coded.error || aside.error ? <p role="alert" className="text-critical px-4 pb-2 text-[12px]">{coded.error ?? aside.error}</p> : null}
  </div>;
}

/** Money spent or received that is not on an invoice or bill: coded to an account, VAT worked out from the rate. */
function CodeIt({ line, accounts }: { line: ReconcileLine; accounts: PickerAccount[] }) {
  const { vatRates } = useRegime();
  const currency = useCurrency();
  const uid = useId();
  const [account, setAccount] = useState("");
  const [rate, setRate] = useState(0);
  const [description, setDescription] = useState(line.description.slice(0, 300));
  const gross = cents(Math.abs(line.amount));
  const net = Math.round(gross / (1 + rate / 100));
  const items: BankMatchItem[] = [{ kind: line.amount > 0 ? "receive" : "spend", contact: line.counterparty, lines: [{ description: description.trim(), account_id: account, net: net / 100, vat_rate: rate, vat_amount: (gross - net) / 100 }] }];
  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_6rem]">
      <label className="text-ink-muted space-y-1 text-[11.5px]"><span className="block">Description</span>
        <TextInput id={`${uid}-description`} value={description} maxLength={300} onChange={event => setDescription(event.target.value)} /></label>
      <label className="text-ink-muted space-y-1 text-[11.5px]"><span className="block">Account</span>
        <NativeSelect aria-label="Account" value={account} onChange={event => setAccount(event.target.value)}><AccountOptions accounts={accounts} /></NativeSelect></label>
      <label className="text-ink-muted space-y-1 text-[11.5px]"><span className="block">VAT</span>
        <NativeSelect aria-label="VAT rate" value={String(rate)} onChange={event => setRate(Number(event.target.value))}>{vatRates.map(value => <option key={value} value={value}>{value}%</option>)}</NativeSelect></label>
    </div>
    {rate ? <p className="text-ink-muted text-[12px] tabular-nums">{formatAmount(net / 100, currency)} plus {formatAmount((gross - net) / 100, currency)} VAT</p> : null}
    <MatchButton lineId={line.id} items={items} disabled={!account || !description.trim()} />
  </div>;
}

function TransferTo({ line, banks }: { line: ReconcileLine; banks: { id: string; code: string; name: string }[] }) {
  const [bank, setBank] = useState(banks[0]?.id ?? "");
  return <div className="space-y-3">
    <label className="text-ink-muted block max-w-sm space-y-1 text-[11.5px]"><span className="block">{line.amount < 0 ? "Moved to" : "Moved from"}</span>
      <NativeSelect aria-label={line.amount < 0 ? "Moved to" : "Moved from"} value={bank} onChange={event => setBank(event.target.value)}>
        {banks.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
      </NativeSelect></label>
    <MatchButton lineId={line.id} items={[{ kind: "transfer", account_id: bank }]} disabled={!bank} />
  </div>;
}

function SetAside({ line }: { line: ReconcileLine }) {
  const [state, action] = useActionState(setLineExcluded, idleState);
  return <form action={action} className="space-y-2">
    <input type="hidden" name="line_id" value={line.id} />
    <input type="hidden" name="excluded" value="on" />
    <label className="text-ink-muted block max-w-md space-y-1 text-[11.5px]"><span className="block">Why it is not for the books</span>
      <TextInput name="reason" maxLength={300} placeholder="e.g. Reversed by the bank the same day" /></label>
    <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Set aside</SubmitButton>
    <FormError message={state.error} />
  </form>;
}

function MatchedLine({ line, documents }: { line: ReconcileLine; documents: MatchedDocumentView[] }) {
  const currency = useCurrency();
  return <div className={ROW}>
    <LineCells line={line} />
    <div className={cn(WIDE, "space-y-0.5 text-[12px]")}>
      {documents.map((document, index) => <span key={index} className="flex min-w-0 items-center gap-1.5">
        <Check aria-hidden className="text-positive size-3.5 shrink-0" />
        {document.href ? <Link href={document.href} className="text-brand min-w-0 truncate hover:underline">{document.label}</Link> : <span className="text-ink-muted min-w-0 truncate">{document.label}</span>}
        <span className="text-ink-faint shrink-0 tabular-nums">{signed(document.amount, currency)}</span>
      </span>)}
    </div>
    <form action={unmatchLine} className="[grid-area:act] flex justify-end self-center"><input type="hidden" name="line_id" value={line.id} /><InlineSubmit title="Keeps what was recorded">Unmatch</InlineSubmit></form>
  </div>;
}

function SetAsideLine({ line }: { line: ReconcileLine }) {
  const [state, action] = useActionState(setLineExcluded, idleState);
  return <div className={ROW}>
    <LineCells line={line} />
    <p className={cn(WIDE, "text-ink-muted text-[12px]")}>{line.excluded_reason ?? "Set aside"}</p>
    <form action={action} className="[grid-area:act] flex flex-col items-end gap-1 self-center">
      <input type="hidden" name="line_id" value={line.id} />
      <input type="hidden" name="excluded" value="" />
      <InlineSubmit>Include again</InlineSubmit>
      <FormError message={state.error} />
    </form>
  </div>;
}
