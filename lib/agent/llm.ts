/**
 * Thin LLM access layer.
 *
 * Per docs/adr/0001-own-agent-orchestrator.md we use the Vercel AI SDK for what
 * it is good at — provider abstraction and schema-constrained generation — and
 * keep the agent loop in our own orchestrator. Swapping Anthropic for OpenAI /
 * DeepSeek later means changing only `getModel()`.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { z } from "zod";

/** Single place that decides which model Pulse runs on. */
export function getModel() {
  return anthropic("claude-3-5-sonnet-20241022");
}

/**
 * Hard cap per model call. A hung provider connection would otherwise stall
 * the orchestrator forever and leave the UI stuck on "running" — a timeout
 * surfaces as a normal decision/tool error the loop already knows how to handle.
 */
const LLM_TIMEOUT_MS = 60_000;

/**
 * Schema-constrained generation: the model never returns free-form JSON.
 * Callers still re-validate the result at the runtime boundary (two-layer
 * validation) — this helper is layer one.
 */
export async function generateStructured<T extends z.ZodTypeAny>(options: {
  schema: T;
  system: string;
  prompt: string;
}): Promise<z.infer<T>> {
  const { object } = await generateObject({
    model: getModel(),
    schema: options.schema,
    system: options.system,
    prompt: options.prompt,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  return object;
}

/**
 * Shared system prompt fragment enforcing the product's drafting boundary:
 * Pulse helps write replies worth posting — it is not stealth marketing.
 */
export const DRAFTING_POLICY = `You help an indie developer write community replies and posts worth publishing (Reddit, Hacker News).
Rules you must enforce:
- Do NOT mention the user's own project by default.
- Only reference their project when the thread explicitly asks for tools, examples, personal projects, or lived experience — and then frame it as experience, never promotion.
- Prefer practical lessons, specific trade-offs, and concrete details over generic advice.
- Match the tone and norms of the target community.
- Never sound like an ad.`;
