"use client";

import { useActionState } from "react";

import { undoImport } from "@/lib/actions/bank";
import { idleState } from "@/lib/actions/state";
import { formatDate, formatDateTime } from "@/lib/format";
import { InlineSubmit } from "@/components/common/form-fields";

export type ImportView = { id: string; source: "file" | "feed"; file_name: string | null; added: number; skipped: number; first_date: string | null; last_date: string | null; imported_at: string };

function Undo({ id }: { id: string }) {
  const [state, action] = useActionState(undoImport, idleState);
  return <form action={action} className="flex items-center gap-2">
    <input type="hidden" name="import_id" value={id} />
    <InlineSubmit destructive title="Removes the lines it added that are not matched">Undo</InlineSubmit>
    {state.error ? <span role="alert" className="text-critical text-[11.5px]">{state.error}</span> : null}
  </form>;
}

/** The statements imported for one account, newest first. Undoing one keeps any line already matched. */
export function ImportHistory({ imports }: { imports: ImportView[] }) {
  return <ul className="divide-hairline divide-y">
    {imports.map(item => <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[12.5px]">
      <span className="text-ink min-w-0 flex-1 basis-full truncate sm:basis-0">{item.source === "feed" ? "Bank feed" : item.file_name ?? "Statement file"}</span>
      <span className="text-ink-muted tabular-nums">{item.first_date && item.last_date ? `${formatDate(item.first_date)} – ${formatDate(item.last_date)}` : "No new lines"}</span>
      <span className="text-ink-muted tabular-nums">{item.added} added{item.skipped ? ` · ${item.skipped} already here` : ""}</span>
      <span className="text-ink-faint text-[11.5px]">{formatDateTime(item.imported_at)}</span>
      {item.added ? <Undo id={item.id} /> : null}
    </li>)}
  </ul>;
}
