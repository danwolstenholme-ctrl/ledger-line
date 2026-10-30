import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getAccountingSettings, getBankAccounts } from "@/lib/data/accounts";
import { PageBody } from "@/components/common/primitives";
import { AccountingSettingsForm, AiSuggestionsForm, VatSchemeForm } from "@/components/accounts/forms";
import { regimeOf } from "@/lib/domain/regimes";
import { RecordDetail, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { InvoiceSettingsForm } from "@/components/sales/sale-actions";
import { getDocumentStyles } from "@/lib/data/document-styles";
import { logoVersion, suggestNumber } from "@/lib/data/sales";
import { DOCUMENT_LANGUAGES } from "@/lib/documents/document-words";
import { LAYOUTS } from "@/lib/documents/style";
import { recordOutlineButton } from "@/components/records/record-layout";
import { firmToday } from "@/lib/domain/invoices";

export const metadata: Metadata = { title: "Company settings" };

/** The lock date, where payments land by default, the financial year, and the company's registration details. */
export default async function AccountsSettingsPage() {
  const org = await requireOrg();
  const [{ settings }, banks, logo, styles, next] = await Promise.all([getAccountingSettings(), getBankAccounts(), logoVersion(org.id), getDocumentStyles(), suggestNumber(org, "invoice")]);
  const standard = styles.find(row => row.is_default);
  const quarters = { 1: "January, April, July, October", 2: "February, May, August, November", 3: "March, June, September, December" } as Record<number, string>;
  const regime = regimeOf(org.country);
  // Two columns that each run on, so a tall card never leaves a gap beside a short one.
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="Company settings" />
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Invoices and quotes">
          <div className="p-4 sm:p-5"><InvoiceSettingsForm prefix={org.invoice_prefix} terms={org.payment_terms_days} year={firmToday().slice(0, 4)} next={next} /></div>
        </RecordSection>
        <RecordSection title="The books">
          <div className="p-4 sm:p-5"><AccountingSettingsForm settings={settings} bankAccounts={banks.rows.filter(item => item.isActive || item.id === settings.default_bank_account_id)} /></div>
          <div className="border-hairline text-ink-muted space-y-2 border-t px-4 py-3.5 text-[12.5px] leading-relaxed sm:px-5">
            <p>Once a period is reported (a VAT return filed, the year’s accounts signed), lock it: nothing dated on or before the lock date can then be added, changed or removed. The check runs inside the database, on every posting.</p>
            <p>A correction after that goes in the next open period, usually as a <Link href="/accounts/journals/new" className="text-brand hover:underline">journal</Link>. Filing a VAT return in Ledgerline moves the lock date for you.</p>
          </div>
        </RecordSection>
        <RecordSection title="Registration" hint={`${regime.name}: ${regime.taxAuthority} and ${regime.registrar}, in ${regime.currencyName}`}>
          <dl className="divide-hairline divide-y px-4 sm:px-5">
            <RecordDetail label="Company" value={<>{org.name}{org.greek_name ? <span className="text-ink-muted block">{org.greek_name}</span> : null}</>} />
            <RecordDetail label={regime.labels.registration} value={org.he_number} />
            <RecordDetail label={regime.labels.vatNumber} value={org.vat_registered ? org.vat_number : "Not registered for VAT"} />
            <RecordDetail label={regime.labels.taxId} value={org.tic} />
            {org.country === "GB" ? null : <RecordDetail label="VAT quarters end" value={org.vat_registered ? quarters[org.vat_quarter_end_month] : "—"} />}
            <RecordDetail label="Address" value={org.address} />
            <RecordDetail label="Contact" value={org.contact_name ? `${org.contact_name}${org.contact_email ? ` · ${org.contact_email}` : ""}` : null} />
          </dl>
        </RecordSection>
      </div>
      <div className="min-w-0 space-y-4">
        {org.country === "GB" && org.vat_registered ? <RecordSection title="VAT" hint="Making Tax Digital">
          <div className="p-4 sm:p-5"><VatSchemeForm values={{ vat_period: org.vat_period, vat_quarter_end_month: org.vat_quarter_end_month, vat_year_end_month: org.vat_year_end_month,
            vat_annual_payments: org.vat_annual_payments, vat_cash_accounting: org.vat_cash_accounting, vat_flat_rate: org.vat_flat_rate === null ? null : Number(org.vat_flat_rate) }} /></div>
        </RecordSection> : null}
        <RecordSection title="How your documents look" hint={`${styles.length} style${styles.length === 1 ? "" : "s"}`}>
          <dl className="divide-hairline divide-y px-4 sm:px-5">
            <RecordDetail label="Default style" value={standard ? `${standard.name}: ${LAYOUTS.find(layout => layout.key === standard.style.layout)?.label.toLowerCase()} layout` : null} />
            <RecordDetail label="Language" value={DOCUMENT_LANGUAGES.find(item => item.value === org.document_language)?.label} />
            <RecordDetail label="Logo" value={logo ? "On every document" : "None: the company’s name is printed"} />
          </dl>
          <div className="border-hairline border-t px-4 py-3 sm:px-5"><Link href="/accounts/settings/documents" className={recordOutlineButton}>Change how they look</Link></div>
        </RecordSection>
        <RecordSection title="AI in the books" hint={settings.ai_suggestions ? "On" : "Off"}>
          <div className="text-ink-muted space-y-2 p-4 text-[13px] leading-relaxed sm:p-5">
            <p>When this is on, Claude is asked only when someone presses its button: to explain the figures (totals only, no names), to answer a question about the books, and to suggest what unplaced bank lines were. Every suggestion is checked against the books, and nothing is matched until someone presses Match. Nothing Claude says is stored.</p>
            <p className={aiConfigured() ? "text-positive" : "text-caution"}>{aiConfigured() ? "Connected to Claude by Anthropic." : "AI is not connected yet."}</p>
            <div className="pt-1"><AiSuggestionsForm enabled={settings.ai_suggestions} /></div>
          </div>
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
