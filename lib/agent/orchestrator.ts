/**
 * The agent orchestrator — the heart of Pulse.
 *
 * This is deliberately NOT the AI SDK's automatic tool-calling loop
 * (docs/adr/0001-own-agent-orchestrator.md). The runtime owns the control
 * surface so every piece of it stays explainable:
 *
 *   while (!terminated) {
 *     decision  = decideNextAction(context)        // model proposes (layer-1 validated)
 *     validated = validate(decision)               // runtime re-checks   (layer-2)
 *     result    = executeTool(validated)           // runtime executes
 *     emit(timelineEvent)                          // every step streams to the UI
 *     context   = compressAndUpdate(context, ...)  // token-conscious memory
 *     terminated = shouldTerminate(context)        // bounded, explicit exit
 *   }
 */
import { randomUUID } from "node:crypto";
import { AGENT_LIMITS } from "@/lib/config";
import { decideNextAction } from "@/lib/agent/decide";
import {
  toolInputSchemas,
  toolOutputSchemas,
  type AgentDecision,
  type ToolName,
} from "@/lib/agent/schemas";
import { toolExecutors } from "@/lib/agent/tools";
import type { AgentContext, RunResult, TimelineEvent } from "@/lib/agent/types";

/** Orchestrator → API route callback; the route forwards events as SSE. */
export type EmitFn = (event: TimelineEvent) => void;

/**
 * Build one timeline event. `tool` is the structured link for tool_* events —
 * the UI matches on it, while `title` stays free-form display copy.
 */
function makeEvent(opts: {
  type: TimelineEvent["type"];
  title: string;
  tool?: ToolName;
  reason?: string;
  detail?: string;
}): TimelineEvent {
  return {
    id: `evt-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    ...opts,
  };
}

function freshContext(topic: string): AgentContext {
  return {
    topic,
    steps: 0,
    searchAttempts: 0,
    draftAttempts: 0,
    posts: [],
    quality: null,
    selectedPost: null,
    comments: [],
    gap: null,
    rules: null,
    drafts: [],
    dataSource: null,
    failures: [],
  };
}

/**
 * Fold a validated tool result into the context, compressing as we go:
 * lists are capped, only summaries are stored, and stale state is reset when
 * a retry invalidates it (e.g. a new search clears the previous quality score).
 */
function compressAndUpdateContext(
  ctx: AgentContext,
  tool: ToolName,
  input: unknown,
  output: unknown,
): AgentContext {
  const next = { ...ctx };

  switch (tool) {
    case "search_reddit": {
      const out = toolOutputSchemas.search_reddit.parse(output);
      next.searchAttempts += 1;
      next.posts = out.posts.slice(0, AGENT_LIMITS.maxPostsInContext);
      next.dataSource = out.source;
      next.quality = null; // new results invalidate the previous evaluation
      break;
    }
    case "evaluate_result_quality": {
      next.quality = toolOutputSchemas.evaluate_result_quality.parse(output);
      break;
    }
    case "get_post_comments": {
      const out = toolOutputSchemas.get_post_comments.parse(output);
      const inp = toolInputSchemas.get_post_comments.parse(input);
      next.comments = out.comments.slice(0, AGENT_LIMITS.maxCommentsInContext);
      // Committing to a thread happens here: reading its comments selects it.
      next.selectedPost = ctx.posts.find((p) => p.id === inp.postId) ?? null;
      break;
    }
    case "evaluate_content_gap": {
      next.gap = toolOutputSchemas.evaluate_content_gap.parse(output);
      break;
    }
    case "check_subreddit_rules": {
      next.rules = toolOutputSchemas.check_subreddit_rules.parse(output);
      break;
    }
    case "draft_comment_reply": {
      const out = toolOutputSchemas.draft_comment_reply.parse(output);
      next.draftAttempts += 1;
      next.drafts = out.drafts;
      break;
    }
  }
  return next;
}

/** Explicit, bounded exit condition — the loop can never run away. */
function shouldTerminate(ctx: AgentContext, decision: AgentDecision): boolean {
  if (decision.action === "finish" || decision.action === "fail") return true;
  if (ctx.steps >= AGENT_LIMITS.maxSteps) return true;
  return false;
}

/** One-line human-readable summary of a tool result for the timeline. */
function describeResult(tool: ToolName, output: unknown): string {
  switch (tool) {
    case "search_reddit": {
      const out = toolOutputSchemas.search_reddit.parse(output);
      return `${out.posts.length} posts (${out.source} data)`;
    }
    case "evaluate_result_quality": {
      const out = toolOutputSchemas.evaluate_result_quality.parse(output);
      return `score ${out.score}, ${out.acceptable ? "acceptable" : "below threshold"}`;
    }
    case "get_post_comments": {
      const out = toolOutputSchemas.get_post_comments.parse(output);
      return `${out.comments.length} top comments (${out.source} data)`;
    }
    case "evaluate_content_gap": {
      const out = toolOutputSchemas.evaluate_content_gap.parse(output);
      return `${out.missingAngles.length} missing angles found`;
    }
    case "check_subreddit_rules": {
      const out = toolOutputSchemas.check_subreddit_rules.parse(output);
      return `${out.hints.length} tone hints for r/${out.subreddit}`;
    }
    case "draft_comment_reply": {
      const out = toolOutputSchemas.draft_comment_reply.parse(output);
      return `${out.drafts.length} drafts generated`;
    }
  }
}

/**
 * Returns why a proposed tool call exceeds its runtime attempt budget, or null
 * if it is within limits. This is enforced here — not just in the prompt — so
 * a live model that ignores its instructions still cannot loop past the caps
 * (the "retry limits live in application code" promise from ADR-0001).
 */
function attemptLimitViolation(ctx: AgentContext, toolName: ToolName): string | null {
  if (toolName === "search_reddit" && ctx.searchAttempts >= AGENT_LIMITS.maxSearchAttempts) {
    return `search_reddit rejected: attempt limit reached (${ctx.searchAttempts}/${AGENT_LIMITS.maxSearchAttempts}). Work with the posts already in context or finish.`;
  }
  if (toolName === "draft_comment_reply" && ctx.draftAttempts >= AGENT_LIMITS.maxDraftAttempts) {
    return `draft_comment_reply rejected: attempt limit reached (${ctx.draftAttempts}/${AGENT_LIMITS.maxDraftAttempts}). Finish with the existing drafts or fail.`;
  }
  return null;
}

/**
 * Run one complete agent loop for a topic, emitting timeline events along the
 * way. Returns the final RunResult (also emitted by the API route as SSE).
 * `signal` aborts the loop between steps (e.g. the client disconnected).
 */
export async function runAgent(
  topic: string,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<RunResult> {
  let ctx = freshContext(topic);
  // Flipped on any abnormal termination (fail action, decision error,
  // cancellation, step cap) — becomes the structured RunResult.outcome.
  let failed = false;
  emit(makeEvent({ type: "run_start", title: "Agent run started", reason: `Topic: "${topic}"` }));

  let terminated = false;
  while (!terminated) {
    // Caller cancelled (client disconnect / new run) — stop before spending
    // another model call. Checked at the top so no step starts after abort.
    if (signal?.aborted) {
      failed = true;
      emit(makeEvent({ type: "error", title: "Run cancelled", reason: "The client disconnected before the run finished." }));
      break;
    }

    ctx = { ...ctx, steps: ctx.steps + 1 };

    /* -- 1. The model proposes one structured decision. ---------------- */
    let decision: AgentDecision;
    try {
      decision = await decideNextAction(ctx);
    } catch (err) {
      failed = true;
      emit(makeEvent({ type: "error", title: "Decision failed", reason: String(err) }));
      break;
    }
    emit(
      makeEvent({
        type: "decision",
        title:
          decision.action === "call_tool"
            ? `Decided: ${decision.toolName}`
            : `Decided: ${decision.action}`,
        reason: decision.reason,
      }),
    );

    if (decision.action !== "call_tool") {
      // finish / fail — emit the terminal event and stop.
      if (decision.action === "fail") failed = true;
      emit(
        makeEvent({
          type: decision.action === "finish" ? "finish" : "error",
          title: decision.action === "finish" ? "Run finished" : "Run failed",
          reason: decision.reason,
        }),
      );
      terminated = true;
      continue;
    }

    /* -- 2. Layer-2 validation: never trust the proposal blindly. ------- */
    const toolName = decision.toolName as ToolName | undefined;
    if (!toolName || !(toolName in toolInputSchemas)) {
      ctx.failures.push(`Unknown tool "${decision.toolName}"`);
      emit(makeEvent({ type: "tool_error", title: "Invalid decision", detail: `Unknown tool "${decision.toolName}"` }));
      terminated = shouldTerminate(ctx, decision);
      continue;
    }
    // Runtime attempt budgets — independent of what the prompt asked for.
    const limitViolation = attemptLimitViolation(ctx, toolName);
    if (limitViolation) {
      ctx.failures.push(limitViolation);
      emit(makeEvent({ type: "tool_error", title: `${toolName} rejected`, tool: toolName, detail: limitViolation }));
      terminated = shouldTerminate(ctx, decision);
      continue;
    }
    const parsedInput = toolInputSchemas[toolName].safeParse(decision.input);
    if (!parsedInput.success) {
      // The failure is stored in context so the model can correct itself next step.
      const msg = `Input for ${toolName} failed validation: ${parsedInput.error.issues[0]?.message}`;
      ctx.failures.push(msg);
      emit(makeEvent({ type: "tool_error", title: `${toolName} rejected`, tool: toolName, detail: msg }));
      terminated = shouldTerminate(ctx, decision);
      continue;
    }

    /* -- 3. Execute, validate output, fold into context. ---------------- */
    emit(makeEvent({ type: "tool_start", title: toolName, tool: toolName, reason: decision.reason }));
    try {
      const executor = toolExecutors[toolName] as (
        input: unknown,
        ctx: AgentContext,
      ) => Promise<unknown>;
      const rawOutput = await executor(parsedInput.data, ctx);
      const parsedOutput = toolOutputSchemas[toolName].safeParse(rawOutput);
      if (!parsedOutput.success) {
        throw new Error(`Output failed validation: ${parsedOutput.error.issues[0]?.message}`);
      }

      ctx = compressAndUpdateContext(ctx, toolName, parsedInput.data, parsedOutput.data);
      emit(makeEvent({ type: "tool_result", title: toolName, tool: toolName, detail: describeResult(toolName, parsedOutput.data) }));
    } catch (err) {
      ctx.failures.push(`${toolName} failed: ${String(err)}`);
      emit(makeEvent({ type: "tool_error", title: `${toolName} failed`, tool: toolName, detail: String(err) }));
    }

    /* -- 4. Bounded exit check. ------------------------------------------ */
    terminated = shouldTerminate(ctx, decision);
    if (terminated && ctx.steps >= AGENT_LIMITS.maxSteps) {
      failed = true;
      emit(makeEvent({ type: "error", title: "Step limit reached", reason: `Stopped after ${ctx.steps} steps (cap: ${AGENT_LIMITS.maxSteps}).` }));
    }
  }

  return {
    outcome: failed ? "failed" : "success",
    topic: ctx.topic,
    selectedPost: ctx.selectedPost,
    gap: ctx.gap,
    rules: ctx.rules,
    drafts: ctx.drafts,
    dataSource: ctx.dataSource,
    steps: ctx.steps,
  };
}
