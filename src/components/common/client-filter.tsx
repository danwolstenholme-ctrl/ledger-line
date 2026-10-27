"use client";

import { useRouter } from "next/navigation";

import { RecordFilterLinks } from "@/components/records/record-layout";
import { NativeSelect } from "@/components/common/form-fields";

/**
 * Which client a practice page shows. Up to fifteen are tabs; a practice with
 * dozens or a hundred clients gets one picker instead, which the browser lets
 * you type into to find a name.
 */
export function ClientFilter({ label, options }: { label: string; options: { label: string; href: string; active: boolean }[] }) {
  const router = useRouter();
  if (options.length <= 16) return <RecordFilterLinks label={label} options={options} />;
  const current = options.find(option => option.active) ?? options[0];
  return <label className="text-ink-muted flex items-center gap-2 text-[12.5px]">
    {label}
    <NativeSelect aria-label={label} value={current.href} onChange={event => router.push(event.target.value)} className="w-64">
      {options.map(option => <option key={option.href} value={option.href}>{option.label}</option>)}
    </NativeSelect>
  </label>;
}
