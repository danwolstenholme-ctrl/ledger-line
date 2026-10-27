"use client";

import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { ACCOUNT_TYPES, ACCOUNT_TYPE_ORDER, codableAccounts, vatOn, type PickerAccount } from "@/lib/domain/accounts";
import { plainDecimal } from "@/lib/domain/line-math";
import { cn } from "@/lib/utils";
import { NativeSelect, TextInput } from "@/components/common/form-fields";
import { useCurrency, useCurrencySymbol, useRegime } from "@/components/common/regime";
import { useI18n } from "@/components/common/locale";

/** An account select grouped by type, in the order the chart is read. */
export function AccountOptions({ accounts, placeholder }: { accounts: PickerAccount[]; placeholder?: string }) {
  const { t } = useI18n();
  return <>
    <option value="">{placeholder ?? t("Choose an account")}</option>
    {ACCOUNT_TYPE_ORDER.map(type => {
      const own = accounts.filter(account => account.type === type);
      return own.length ? <optgroup key={type} label={t(ACCOUNT_TYPES[type].group)}>
        {own.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
      </optgroup> : null;
    })}
  </>;
}

export type LineValue = { description: string; account_id: string; net: string; vat_rate: number; vat_amount: string; vatTouched?: boolean };

// "18,50" in Greek, "18.50" in English: either is read (plainDecimal).
const cents = (value: string) => {
  const parsed = Number(plainDecimal(value));
  return Number.isFinite(parsed) && value.trim() !== "" ? Math.round(parsed * 100) : null;
};
const ROW = "xl:grid-cols-[minmax(0,1fr)_12rem_6.5rem_5rem_6rem_2.25rem] xl:gap-3";
/** Shown above each field while lines stack; each field carries its full name for screen readers. */
const LABEL = "text-ink-muted block text-[12px] xl:hidden";

/**
 * Lines as the supplier printed them: what it was, which account it belongs
 * to, the net amount and the VAT rate. The VAT works itself out from the rate
 * and can be corrected by a cent to match the invoice, as the database allows.
 */
export function LineEditor({ accounts, initial, defaultRate, defaultAccount = "", error, onChange, reverseCharge = false, noVat = false, codable = true }: {
  accounts: PickerAccount[];
  initial?: LineValue[];
  defaultRate?: number;
  defaultAccount?: string;
  error?: string;
  onChange?: () => void;
  /** The supplier charged no VAT: the lines' VAT is the firm's to account for, and the total is the net. */
  reverseCharge?: boolean;
  /** A sale that carries no VAT (exempt, reverse charge, outside the scope): every line at 0%. */
  noVat?: boolean;
  /** Offer only accounts a document line can be coded to; "bank" also offers the VAT account, as money paid to or from the Tax Department. Off when the caller has already chosen the accounts. */
  codable?: boolean | "bank";
}) {
  const symbol = useCurrencySymbol();
  const { vatRates } = useRegime();
  const currency = useCurrency();
  const { t, locale, formatAmount } = useI18n();
  // A figure as it is written in the screen's language: 18,50 in Greek.
  const shown = (value: string) => locale === "el" ? value.replace(".", ",") : value;
  const plain = (value: number) => shown((value / 100).toFixed(2));
  const uid = useId();
  const nextKey = useRef(initial?.length ?? 1);
  const blank = (key: number): LineValue & { key: number } => ({ key, description: "", account_id: defaultAccount, net: "", vat_rate: defaultRate ?? vatRates[0], vat_amount: "" });
  // A saved line keeps its VAT only where someone corrected it by hand; otherwise the VAT follows a new net or rate.
  const corrected = (line: LineValue) => cents(line.vat_amount) !== Math.round(vatOn((cents(line.net) ?? 0) / 100, line.vat_rate) * 100);
  const [lines, setLines] = useState<(LineValue & { key: number })[]>(initial?.length ? initial.map((line, key) => ({ ...line, net: shown(line.net), vat_amount: shown(line.vat_amount), key, vatTouched: corrected(line) })) : [blank(0)]);
  const options = codable ? codableAccounts(accounts, { vat: codable === "bank" }) : accounts;

  function update(key: number, patch: Partial<LineValue>) {
    setLines(current => current.map(line => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      // The VAT follows the net and the rate until somebody types their own figure.
      if (("net" in patch || "vat_rate" in patch) && !next.vatTouched) {
        const net = cents(next.net);
        next.vat_amount = net === null ? "" : plain(Math.round(vatOn(net / 100, next.vat_rate) * 100));
      }
      return next;
    }));
    onChange?.();
  }
  const add = () => { nextKey.current += 1; setLines(current => [...current, blank(nextKey.current)]); onChange?.(); };
  const remove = (key: number) => { setLines(current => current.length > 1 ? current.filter(line => line.key !== key) : current); onChange?.(); };

  const net = lines.reduce((sum, line) => sum + (cents(line.net) ?? 0), 0);
  const vat = noVat ? 0 : lines.reduce((sum, line) => sum + (cents(line.vat_amount) ?? 0), 0);
  const amount = "text-right tabular-nums";

  return <div className="space-y-2">
    <input type="hidden" name="lines" value={JSON.stringify(lines.map(line => ({
      description: line.description, account_id: line.account_id, net: cents(line.net) === null ? "" : (cents(line.net)! / 100),
      vat_rate: noVat ? 0 : line.vat_rate, vat_amount: noVat || cents(line.vat_amount) === null ? 0 : cents(line.vat_amount)! / 100,
    })))} />
    {/* One row per line on a wide screen; on anything narrower each line stacks, labelled, as the invoice form's do. */}
    <div aria-hidden className={cn("text-ink-faint hidden text-[11.5px] font-semibold tracking-[0.06em] uppercase xl:grid", ROW)}>
      <span>{t("Description")}</span><span>{t("Account")}</span><span className="text-right">{t("Net")} {symbol}</span><span>{t("VAT")}</span><span className="text-right">{t("VAT")} {symbol}</span><span />
    </div>
    <ol className="space-y-3">{lines.map((line, index) => <li key={line.key} className={cn("border-hairline grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 xl:items-start xl:border-b-0 xl:pb-0", ROW)}>
      <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>{t("Description")}</span>
        <TextInput aria-label={t("Line {number} description", { number: index + 1 })} value={line.description} maxLength={300} onChange={event => update(line.key, { description: event.target.value })} placeholder={t("What it was")} /></label>
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_minmax(0,1fr)_2.75rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_5rem_6rem_2.25rem] xl:contents">
        <label className="col-span-4 min-w-0 space-y-1 sm:col-span-1"><span aria-hidden className={LABEL}>{t("Account")}</span>
          <NativeSelect aria-label={t("Line {number} account", { number: index + 1 })} value={line.account_id} onChange={event => update(line.key, { account_id: event.target.value })}><AccountOptions accounts={options} /></NativeSelect></label>
        <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>{t("Net")} {symbol}</span>
          <TextInput aria-label={t("Line {number} net amount", { number: index + 1 })} inputMode="decimal" value={line.net} onChange={event => update(line.key, { net: event.target.value })} className={amount} placeholder={shown("0.00")} /></label>
        <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>{t("VAT")}</span>
          <NativeSelect aria-label={t("Line {number} VAT rate", { number: index + 1 })} value={noVat ? "0" : String(line.vat_rate)} disabled={noVat} onChange={event => update(line.key, { vat_rate: Number(event.target.value) })}>
            {vatRates.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
          </NativeSelect></label>
        <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>{t("VAT")} {symbol}</span>
          <TextInput aria-label={t("Line {number} VAT amount", { number: index + 1 })} inputMode="decimal" value={noVat ? shown("0.00") : line.vat_amount} disabled={noVat} onChange={event => update(line.key, { vat_amount: event.target.value, vatTouched: true })} className={amount} placeholder={shown("0.00")} /></label>
        <button type="button" onClick={() => remove(line.key)} disabled={lines.length === 1} aria-label={t("Remove line {number}", { number: index + 1 })}
          className="text-ink-faint hover:text-critical inline-grid size-9 place-items-center self-end rounded disabled:opacity-30 touch:size-11 xl:self-start"><X className="size-3.5" /></button>
      </div>
    </li>)}</ol>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <button type="button" onClick={add} className="text-brand inline-flex items-center gap-1 text-[13px] font-medium hover:underline touch:min-h-10"><Plus className="size-3.5" />{t("Add a line")}</button>
      <dl id={`${uid}-totals`} className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-[13px]">
        <dt className="text-ink-muted">{t("Net")}</dt><dd className="text-right tabular-nums">{formatAmount(net / 100, currency)}</dd>
        <dt className="text-ink-muted">{reverseCharge ? t("VAT due and reclaimed") : noVat ? t("No VAT charged") : t("VAT")}</dt><dd className="text-right tabular-nums">{formatAmount(vat / 100, currency)}</dd>
        <dt className="text-ink font-semibold">{reverseCharge ? t("Total, no VAT charged") : t("Total")}</dt><dd className={cn("text-right font-semibold tabular-nums")}>{formatAmount((reverseCharge ? net : net + vat) / 100, currency)}</dd>
      </dl>
    </div>
    {error ? <p role="alert" className="text-critical text-[12.5px]">{t.message(error)}</p> : null}
  </div>;
}
