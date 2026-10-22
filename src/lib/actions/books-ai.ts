"use server";

import { FormParser } from "@/lib/actions/form";
import { requireOrg } from "@/lib/org";
import { aiConfigured } from "@/lib/ai/anthropic";
import { booksFacts, explainBooks } from "@/lib/ai/books-overview";
import { answerBooksQuestion, describeCall } from "@/lib/ai/books-questions";
import { getAccountingSettings, getAccountsDashboard } from "@/lib/data/accounts";
import { BOOKS_QUESTION_MAX, idleOverview, idleQuestion, type OverviewState, type QuestionState } from "@/lib/domain/accounts-insights";

/**
 * One press, one read: the overview's figures go to the model as totals, and
 * what it says comes back to the page. Nothing is stored. Behind the same
 * switch as the reconcile screen's suggestions.
 */
export async function explainTheBooks(): Promise<OverviewState> {
  await requireOrg();
  if (!aiConfigured()) return { ...idleOverview, available: false, error: "AI is not set up yet. Add ANTHROPIC_API_KEY to .env.local." };
  const dashboard = await getAccountsDashboard();
  if (!dashboard.settings.ai_suggestions) return { ...idleOverview, available: false, error: "AI is switched off for this company. Switch it on in its Settings." };
  if (dashboard.failed) return { ...idleOverview, error: "The books could not be read just now. Try again in a moment." };
  const answer = await explainBooks(booksFacts(dashboard));
  if (!answer.ok) return { ...idleOverview, error: answer.error };
  return { ok: true, error: null, available: true, overview: answer.value, at: new Date().toISOString() };
}

/**
 * A question about the figures, answered by the model looking them up with
 * read-only tools over the ledger's totals. Says what it looked at. Nothing is
 * stored.
 */
export async function askTheBooks(_previous: QuestionState, form: FormData): Promise<QuestionState> {
  await requireOrg();
  const parser = new FormParser(form);
  const question = parser.text("question", { required: true, max: BOOKS_QUESTION_MAX, label: "Question" });
  if (parser.failed || !question) return { ...idleQuestion, error: Object.values(parser.errors)[0] ?? "Type a question about the figures first." };
  if (!aiConfigured()) return { ...idleQuestion, available: false, error: "AI is not set up yet. Add ANTHROPIC_API_KEY to .env.local." };
  const { settings, today, failed } = await getAccountingSettings();
  if (failed) return { ...idleQuestion, question, error: "The books could not be read just now. Try again in a moment." };
  if (!settings.ai_suggestions) return { ...idleQuestion, available: false, error: "AI is switched off for this company. Switch it on in its Settings." };
  const result = await answerBooksQuestion(question, { today, yearEndMonth: settings.year_end_month });
  if (!result.ok) return { ...idleQuestion, question, error: result.error };
  return { ok: true, error: null, available: true, question, answer: result.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, ""), looked: [...new Set(result.calls.map(describeCall))], at: new Date().toISOString() };
}
