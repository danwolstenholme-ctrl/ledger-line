import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

import { HOSTED_DEMO } from "@/lib/auth/config";

/**
 * The one door to the model. Server-only, so the key never reaches a browser,
 * and nothing here logs what it is asked or answers: the prompts carry
 * supplier invoices, bank lines and the books' figures.
 *
 * A request the model declines is retried on the model Anthropic recommends
 * for that kind of refusal (`fallbacks: "default"`), inside the same call.
 */

const DEFAULT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Claude is asked only with a key, and never by the public hosted demo, which anyone may try (lib/auth/config). */
export function aiConfigured() { return Boolean(process.env.ANTHROPIC_API_KEY) && !HOSTED_DEMO; }

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return client;
}
const model = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
const NOT_SET_UP = "AI is not set up yet. Add ANTHROPIC_API_KEY to .env.local and restart.";

/** Status and class only: an error body can echo the prompt. */
function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof Anthropic.AuthenticationError) { console.error("[ai] request rejected", error.status); return { ok: false, error: "The AI key was refused. Check ANTHROPIC_API_KEY." }; }
  if (error instanceof Anthropic.RateLimitError) { console.error("[ai] request rejected", error.status); return { ok: false, error: "The AI service is busy. Try again in a moment." }; }
  if (error instanceof Anthropic.APIConnectionError) { console.error("[ai] request failed", error.name); return { ok: false, error: "The AI service could not be reached. Try again in a moment." }; }
  if (error instanceof Anthropic.APIError) { console.error("[ai] request rejected", error.status); return { ok: false, error: "The AI service returned an error." }; }
  console.error("[ai] request failed", error instanceof Error ? error.name : "unknown");
  return { ok: false, error: "The AI service returned an error." };
}

export type AiResult = { ok: true; text: string } | { ok: false; error: string };

/** Free text: a summary, a draft. `maxTokens` is a floor for the answer, with room for the model's thinking on top. */
export async function complete(input: { system: string; user: string; maxTokens?: number }): Promise<AiResult> {
  if (!aiConfigured()) return { ok: false, error: NOT_SET_UP };
  try {
    const response = await anthropic().beta.messages.create({
      model: model(), max_tokens: Math.max(input.maxTokens ?? 0, 8000), betas: [FALLBACK_BETA], fallbacks: "default",
      output_config: { effort: "low" }, system: input.system, messages: [{ role: "user", content: input.user }],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "The AI service declined to answer this one." };
    const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();
    return text ? { ok: true, text } : { ok: false, error: "The AI service returned nothing to show." };
  } catch (error) {
    return failure(error);
  }
}

export type AiParsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** What a user turn can carry: text, or a document or image with text beside it. */
export type AiUserContent = string | Anthropic.Beta.BetaContentBlockParam[];

/** A PDF or an image, base64, as a content block placed before the question. */
export function documentBlock(mediaType: string, data: string): Anthropic.Beta.BetaContentBlockParam {
  if (mediaType === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  const media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType) ? mediaType : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  return { type: "image", source: { type: "base64", media_type: media, data } };
}

/** An answer in a fixed shape, checked against `schema` before it is returned. */
export async function completeStructured<T>(input: { system: string; user: AiUserContent; schema: z.ZodType<T>; effort?: "low" | "medium" | "high" }): Promise<AiParsed<T>> {
  if (!aiConfigured()) return { ok: false, error: NOT_SET_UP };
  const format = betaZodOutputFormat(input.schema);
  try {
    // create(), then parse: parse() reads the reply before a refusal can be told apart from a bad answer.
    const response = await anthropic().beta.messages.create({
      model: model(), max_tokens: 16000, betas: [FALLBACK_BETA], fallbacks: "default",
      output_config: { effort: input.effort ?? "medium", format }, system: input.system, messages: [{ role: "user", content: input.user }],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "The AI service declined to answer this one." };
    const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("");
    if (response.stop_reason === "max_tokens" || !text) return { ok: false, error: "The AI service's answer could not be read. Try again." };
    try { return { ok: true, value: format.parse(text) }; }
    catch { console.error("[ai] answer did not fit its shape"); return { ok: false, error: "The AI service's answer could not be read. Try again." }; }
  } catch (error) {
    return failure(error);
  }
}

/** A tool the model may call: its definition, and what running it returns (sent back as JSON). */
export type AiTool = { name: string; description: string; input_schema: Anthropic.Beta.BetaTool.InputSchema; run: (input: Record<string, unknown>) => Promise<unknown> };
export type AiToolCall = { name: string; input: Record<string, unknown> };
export type AiToolResult = { ok: true; text: string; calls: AiToolCall[] } | { ok: false; error: string };

/**
 * A question the model answers by looking things up: it calls the tools it is
 * given, reads what they return, and stops when it can answer. Every turn is
 * appended as it came back, thinking included, so the conversation is only
 * ever added to. `calls` says what it looked at.
 */
export async function completeWithTools(input: { system: string; user: string; tools: AiTool[]; maxTurns?: number }): Promise<AiToolResult> {
  if (!aiConfigured()) return { ok: false, error: NOT_SET_UP };
  const definitions = input.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: input.user }];
  const calls: AiToolCall[] = [];
  try {
    for (let turn = 0; turn < (input.maxTurns ?? 8); turn += 1) {
      const response = await anthropic().beta.messages.create({
        model: model(), max_tokens: 16000, betas: [FALLBACK_BETA], fallbacks: "default",
        output_config: { effort: "low" }, system: input.system, tools: definitions, messages,
      });
      if (response.stop_reason === "refusal") return { ok: false, error: "The AI service declined to answer this one." };
      const uses = response.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
      if (response.stop_reason !== "tool_use" && response.stop_reason !== "pause_turn") {
        const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();
        return text ? { ok: true, text, calls } : { ok: false, error: "The AI service returned nothing to show." };
      }
      messages.push({ role: "assistant", content: response.content });
      if (!uses.length) continue;
      const results = await Promise.all(uses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = input.tools.find(item => item.name === use.name);
        const args = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
        calls.push({ name: use.name, input: args });
        if (!tool) return { type: "tool_result", tool_use_id: use.id, content: `There is no tool called ${use.name}.`, is_error: true };
        try { return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(await tool.run(args)) }; }
        catch (error) { return { type: "tool_result", tool_use_id: use.id, content: error instanceof Error && error.message.startsWith("books:") ? error.message.slice(6).trim() : "That could not be read from the books.", is_error: true }; }
      }));
      messages.push({ role: "user", content: results });
    }
    return { ok: false, error: "That took too many steps to answer. Try asking something narrower." };
  } catch (error) {
    return failure(error);
  }
}
