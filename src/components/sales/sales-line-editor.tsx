"use client";

import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import type { PickerAccount } from "@/lib/domain/accounts";
import { lineCents, priceInput } from "@/lib/domain/line-math";
import type { SaleItemOption, SaleLineValue } from "@/lib/domain/sale-lines";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NativeSelect, TextInput } from "@/components/common/form-fields";
import { VAT_RATES } from "@/types/database";

export type { SaleItemOption, SaleLineValue } from "@/lib/domain/sale-lines";
type Line = SaleLineValue & { key: number };

const ROW = "xl:grid-cols-[minmax(0,1fr)_5rem_7rem_4.5rem_5.25rem_7rem_2.25rem] xl:gap-3";
const LABEL = "text-ink-muted block text-[11.5px] xl:hidden";

/**
 * Lines as a customer reads them: what it is, how many, at what price, any
 * discount, the VAT rate, and the amount. Typing a product's name fills in its
 * price, VAT rate and income account; the account can still be changed under
 * each line. The arithmetic is exact (see line-math) and is done again by the
 * database when the document is saved.
 */
export function SalesLineEditor({ accounts, items, initial, defaultAccount, defaultRate = 19, noVat = false, error }: {
  accounts: PickerAccount[]; items: SaleItemOption[]; initial?: SaleLineValue[]; defaultAccount: string; defaultRate?: number; noVat?: boolean; error?: string;
}) {
  const uid = useId();
  const nextKey = useRef(initial?.length ?? 1);
  const blank = (key: number): Line => ({ key, item_id: null, description: "", unit: null, quantity: "1", unit_price: "", discount_pct: "", vat_rate: defaultRate, account_id: defaultAccount });
  const [lines, setLines] = useState<Line[]>(initial?.length ? initial.map((line, key) => ({ ...line, key })) : [blank(0)]);
  const [showDiscount, setShowDiscount] = useState(() => (initial ?? []).some(line => Number(line.discount_pct) > 0));
  const byName = new Map(items.map(item => [item.name.trim().toLowerCase(), item]));

  function update(key: number, patch: Partial<SaleLineValue>) {
    setLines(current => current.map(line => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if ("description" in patch) {
        // A product's name, typed or picked from the list: its price, rate and account come with it.
        const item = byName.get((patch.description ?? "").trim().toLowerCase());
        if (item && item.id !== line.item_id) Object.assign(next, { item_id: item.id, unit: item.unit, unit_price: priceInput(item.unit_price), vat_rate: Number(item.vat_rate), account_id: item.account_id });
        if (!(patch.description ?? "").trim()) Object.assign(next, { item_id: null, unit: null });
      }
      return next;
    }));
  }
  const add = () => { nextKey.current += 1; setLines(current => [...current, blank(nextKey.current)]); };
  const remove = (key: number) => setLines(current => current.length > 1 ? current.filter(line => line.key !== key) : current);

  const figures = lines.map(line => lineCents({ quantity: line.quantity, unit_price: line.unit_price || "0", discount_pct: line.discount_pct, vat_rate: noVat ? 0 : line.vat_rate }));
  const net = figures.reduce((sum, figure) => sum + (figure?.net ?? 0), 0);
  const byRate = new Map<number, number>();
  lines.forEach((line, index) => { const vat = figures[index]?.vat ?? 0; if (!noVat && vat) byRate.set(line.vat_rate, (byRate.get(line.vat_rate) ?? 0) + vat); });
  const vat = [...byRate.values()].reduce((sum, value) => sum + value, 0);
  const gross = lines.reduce((sum, line) => sum + (lineCents({ quantity: line.quantity, unit_price: line.unit_price || "0", vat_rate: 0 })?.net ?? 0), 0);
  const discounts = gross - net;
  const amount = "text-right tabular-nums";

  return <div className="space-y-2">
    <input type="hidden" name="lines" value={JSON.stringify(lines.map(line => ({
      item_id: line.item_id, description: line.description, unit: line.unit, account_id: line.account_id,
      quantity: line.quantity, unit_price: line.unit_price, discount_pct: line.discount_pct || "0", vat_rate: noVat ? 0 : line.vat_rate,
    })))} />
    <datalist id={`${uid}-items`}>{items.map(item => <option key={item.id} value={item.name}>{`${item.code ? `${item.code} · ` : ""}${formatAmount(item.unit_price)}${item.unit ? ` per ${item.unit}` : ""} · ${item.vat_rate}% VAT`}</option>)}</datalist>
    <div aria-hidden className={cn("text-ink-faint hidden text-[11px] font-semibold tracking-[0.06em] uppercase xl:grid", ROW)}>
      <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price €</span><span className="text-right">{showDiscount ? "Disc %" : ""}</span><span>VAT</span><span className="text-right">Amount €</span><span />
    </div>
    <ol className="space-y-3">{lines.map((line, index) => {
      const figure = figures[index];
      return <li key={line.key} className={cn("border-hairline grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 xl:items-start xl:border-b-0 xl:pb-0", ROW)}>
        <div className="min-w-0 space-y-1">
          <label className="block space-y-1"><span aria-hidden className={LABEL}>Description</span>
            <TextInput aria-label={`Line ${index + 1} description`} list={`${uid}-items`} value={line.description} maxLength={300} placeholder={items.length ? "Type a product, or describe the work" : "What it is"}
              onChange={event => update(line.key, { description: event.target.value })} autoComplete="off" /></label>
          <label className="flex min-w-0 items-center gap-1.5"><span className="text-ink-faint shrink-0 text-[11px]">{line.item_id ? "Product ·" : "Income ·"}</span>
            <NativeSelect aria-label={`Line ${index + 1} account`} value={line.account_id} onChange={event => update(line.key, { account_id: event.target.value })}
              className="h-7 min-w-0 border-transparent bg-transparent pr-7 pl-1 text-[11.5px] text-ink-muted shadow-none hover:border-hairline-strong">
              {accounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </NativeSelect></label>
        </div>
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_5.25rem] items-start gap-2 sm:grid-cols-[5rem_7rem_4.5rem_5.25rem_minmax(0,1fr)_2.25rem] xl:contents">
          <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>Qty</span>
            <TextInput aria-label={`Line ${index + 1} quantity`} inputMode="decimal" value={line.quantity} onChange={event => update(line.key, { quantity: event.target.value })} className={amount} />
            {line.unit ? <span className="text-ink-faint block pr-1 text-right text-[11px]">{line.unit}</span> : null}</label>
          <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>Unit price €</span>
            <TextInput aria-label={`Line ${index + 1} unit price`} inputMode="decimal" value={line.unit_price} onChange={event => update(line.key, { unit_price: event.target.value })} className={amount} placeholder="0.00" /></label>
          {showDiscount ? <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>Disc %</span>
            <TextInput aria-label={`Line ${index + 1} discount percent`} inputMode="decimal" value={line.discount_pct} onChange={event => update(line.key, { discount_pct: event.target.value })} className={amount} placeholder="0" /></label>
            : <span aria-hidden className="hidden sm:block" />}
          <label className="min-w-0 space-y-1"><span aria-hidden className={LABEL}>VAT</span>
            <NativeSelect aria-label={`Line ${index + 1} VAT rate`} value={noVat ? "0" : String(line.vat_rate)} disabled={noVat} onChange={event => update(line.key, { vat_rate: Number(event.target.value) })}>
              {VAT_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
            </NativeSelect></label>
          <p className="col-span-3 min-w-0 self-center text-right text-[13px] font-medium tabular-nums sm:col-span-1 xl:self-start xl:pt-[7px]" aria-label={`Line ${index + 1} amount`}>
            {figure ? formatAmount(figure.net / 100) : <span className="text-critical text-[12px] font-normal">Check the figures</span>}
          </p>
          <button type="button" onClick={() => remove(line.key)} disabled={lines.length === 1} aria-label={`Remove line ${index + 1}`}
            className="text-ink-faint hover:text-critical inline-grid size-8 place-items-center justify-self-end rounded disabled:opacity-30 touch:size-11 xl:self-start"><X className="size-3.5" /></button>
        </div>
      </li>;
    })}</ol>
    <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={add} className="text-brand inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline touch:min-h-10"><Plus className="size-3.5" />Add a line</button>
        {!showDiscount ? <button type="button" onClick={() => setShowDiscount(true)} className="text-ink-muted hover:text-brand text-[12.5px] touch:min-h-10">Give a discount</button> : null}
      </div>
      <dl className="grid min-w-56 grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-[12.5px]">
        {discounts > 0 ? <><dt className="text-ink-muted">Discounts</dt><dd className="text-right tabular-nums">−{formatAmount(discounts / 100)}</dd></> : null}
        <dt className="text-ink-muted">Subtotal</dt><dd className="text-right tabular-nums">{formatAmount(net / 100)}</dd>
        {noVat ? <><dt className="text-ink-muted">No VAT charged</dt><dd className="text-right tabular-nums">{formatAmount(0)}</dd></>
          : byRate.size ? [...byRate.entries()].sort(([a], [b]) => b - a).map(([rate, value]) => <span key={rate} className="contents"><dt className="text-ink-muted">VAT at {rate}%</dt><dd className="text-right tabular-nums">{formatAmount(value / 100)}</dd></span>)
          : <><dt className="text-ink-muted">VAT</dt><dd className="text-right tabular-nums">{formatAmount(0)}</dd></>}
        <dt className="text-ink font-semibold">Total</dt><dd className="text-right text-[14px] font-semibold tabular-nums">{formatAmount((net + vat) / 100)}</dd>
      </dl>
    </div>
    {error ? <p role="alert" className="text-critical text-[12px]">{error}</p> : null}
  </div>;
}
