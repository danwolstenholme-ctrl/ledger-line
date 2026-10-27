"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, ImageIcon, Loader2, TriangleAlert, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { readFile, storeFiles } from "@/components/capture/send-files";

type Job = { key: string; name: string; type: string; state: "uploading" | "reading" | "done" | "failed"; detail: string };

/**
 * Drop a mixed batch here: PDFs and photos, Greek or English, for any client.
 * Each file is stored, then read by Claude in its own request, so the batch
 * is read in parallel and each row reports as soon as its file is done.
 */
export function DropZone({ available, rehearsal, company }: { available: boolean; rehearsal: boolean; company?: { id: string; name: string } }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const busy = jobs.some(job => job.state === "uploading" || job.state === "reading");
  const update = (key: string, patch: Partial<Job>) => setJobs(current => current.map(job => job.key === key ? { ...job, ...patch } : job));

  async function send(files: File[]) {
    if (!files.length) return;
    const batch = files.map((file, index) => ({ key: `${Date.now()}-${index}`, name: file.name, type: file.type, state: "uploading" as const, detail: "Uploading…" }));
    setJobs(current => [...batch, ...current]);
    const stored = await storeFiles(files, company?.id);
    if (!stored.ok) { batch.forEach(job => update(job.key, { state: "failed", detail: stored.error })); return; }
    await Promise.all(stored.files.map(async (saved, index) => {
      const job = batch[index];
      if (!saved.id) { update(job.key, { state: "failed", detail: saved.error ?? "Not uploaded." }); return; }
      update(job.key, { state: "reading", detail: "Claude is reading it…" });
      const result = await readFile(saved.id);
      if (result.ok) update(job.key, { state: "done", detail: `${result.count} invoice${result.count === 1 ? "" : "s"} found, checked and routed` });
      else update(job.key, { state: "failed", detail: result.error ?? "Could not be read." });
      router.refresh();
    }));
  }

  return <section className="ll-panel overflow-hidden">
    <label htmlFor="capture-files" onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={event => { event.preventDefault(); setOver(false); if (available) void send([...event.dataTransfer.files]); }}
      className={cn("flex cursor-pointer flex-col items-center gap-2 border-b border-dashed px-6 py-9 text-center transition-colors", over ? "bg-brand-50 border-brand" : "border-hairline-strong hover:bg-surface-sunken", !available && "cursor-not-allowed opacity-60")}>
      <span className="bg-brand-50 text-brand grid size-11 place-items-center rounded-full"><UploadCloud className="size-5" /></span>
      <span className="text-ink text-[14px] font-semibold">{company ? `Drop receipts and supplier invoices for ${company.name}` : "Drop supplier invoices for any client"}</span>
      <span className="text-ink-muted max-w-[60ch] text-[13px] leading-relaxed">{company
        ? "PDFs or photos, Greek or English. Claude reads each one, Ledgerline checks the sums and VAT, matches the supplier and drafts the bill for you to confirm."
        : "PDFs or photos, Greek or English, several invoices to a PDF. Claude reads each one, Ledgerline checks the sums and VAT, works out which client it belongs to from the bill-to name or VAT number, and drafts the bill."}</span>
      <span className="text-brand mt-1 text-[13px] font-medium">{available ? "Choose files or drop them here" : "Add ANTHROPIC_API_KEY to .env.local to read documents"}</span>
      <input ref={input} id="capture-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={!available} className="sr-only"
        onChange={event => { void send([...(event.target.files ?? [])]); if (input.current) input.current.value = ""; }} />
    </label>
    {rehearsal ? <p className="border-hairline bg-caution-soft text-caution border-b px-4 py-1.5 text-[12px]">Rehearsal mode: known demo files use readings recorded earlier instead of asking Claude.</p> : null}
    {jobs.length ? <ul className="divide-hairline divide-y">{jobs.map(job => <li key={job.key} className="flex items-center gap-3 px-4 py-2 text-[13px]">
      {job.type.startsWith("image/") ? <ImageIcon className="text-ink-faint size-4 shrink-0" /> : <FileText className="text-ink-faint size-4 shrink-0" />}
      <span className="text-ink min-w-0 flex-1 truncate">{job.name}</span>
      <span className={cn("flex shrink-0 items-center gap-1.5", job.state === "done" ? "text-positive" : job.state === "failed" ? "text-critical" : "text-ink-muted")}>
        {job.state === "done" ? <CheckCircle2 className="size-3.5" /> : job.state === "failed" ? <TriangleAlert className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
        <span className={cn(job.state === "reading" && "ll-ai-sheen font-medium")}>{job.detail}</span>
      </span>
    </li>)}</ul> : null}
    {busy ? <p className="text-ink-faint px-4 py-1.5 text-[12px]">Files are read at the same time; each takes about as long as a person would take to glance at it.</p> : null}
  </section>;
}
