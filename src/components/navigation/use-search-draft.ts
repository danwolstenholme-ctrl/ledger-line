"use client";

import { useState } from "react";

type SearchDraft = {
  committed: string;
  term: string;
  revision: number;
  requested: { query: string; revision: number } | null;
};

/** Keep the input mounted while distinguishing search responses from history. */
export function useSearchDraft(query: string) {
  const [draft, setDraft] = useState<SearchDraft>({
    committed: query,
    term: query,
    revision: 0,
    requested: null,
  });

  if (draft.committed !== query) {
    const newerTyping = draft.requested?.query === query && draft.revision > draft.requested.revision;
    // Reconcile before React commits the input. Only our own response may keep
    // newer typing; Back/Forward and other URL changes restore their query.
    setDraft({
      ...draft,
      committed: query,
      term: newerTyping ? draft.term : query,
      requested: null,
    });
  }

  function setTerm(term: string) {
    setDraft(current => current.term === term ? current : {
      ...current,
      term,
      revision: current.revision + 1,
    });
  }

  function markRequested(requestedQuery: string) {
    const revision = draft.revision;
    setDraft(current => ({
      ...current,
      requested: { query: requestedQuery, revision },
    }));
  }

  return { term: draft.term, setTerm, markRequested };
}
