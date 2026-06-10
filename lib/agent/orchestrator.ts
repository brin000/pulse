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

let eventCounter = 0;
function makeEvent(
  type: TimelineEvent["type"],
  title: string,
  reason?: string,
  detail?: string,
): TimelineEvent {
  return {
    id: `evt-${Date.now()}-${eventCounter++}`,
    type,
    title,
    reason,
    detail,
    timestamp: new Date().toISOString(),
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
      return `score ${out.score} — ${out.acceptable ? "acceptable" : "below threshold"}`;
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
 * Run one complete agent loop for a topic, emitting timeline events along the
 * way. Returns the final RunResult (also emitted by the API route as SSE).
 */
export async function runAgent(topic: string, emit: EmitFn): Promise<RunResult> {
  let ctx = freshContext(topic);
  emit(makeEvent("run_start", "Agent run started", `Topic: "${topic}"`));

  let terminated = false;
  while (!terminated) {
    ctx = { ...ctx, steps: ctx.steps + 1 };

    /* -- 1. The model proposes one structured decision. ---------------- */
    let decision: AgentDecision;
    try {
      decision = await decideNextAction(ctx);
    } catch (err) {
      emit(makeEvent("error", "Decision failed", String(err)));
      break;
    }
    emit(
      makeEvent(
        "decision",
        decision.action === "call_tool"
          ? `Decided: ${decision.toolName}`
          : `Decided: ${decision.action}`,
        decision.reason,
      ),
    );

    if (decision.action !== "call_tool") {
      // finish / fail — emit the terminal event and stop.
      emit(
        makeEvent(
          decision.action === "finish" ? "finish" : "error",
          decision.action === "finish" ? "Run finished" : "Run failed",
          decision.reason,
        ),
      );
      terminated = true;
      continue;
    }

    /* -- 2. Layer-2 validation: never trust the proposal blindly. ------- */
    const toolName = decision.toolName as ToolName | undefined;
    if (!toolName || !(toolName in toolInputSchemas)) {
      ctx.failures.push(`Unknown tool "${decision.toolName}"`);
      emit(makeEvent("tool_error", "Invalid decision", undefined, `Unknown tool "${decision.toolName}"`));
      terminated = shouldTerminate(ctx, decision);
      continue;
    }
    const parsedInput = toolInputSchemas[toolName].safeParse(decision.input);
    if (!parsedInput.success) {
      // The failure is stored in context so the model can correct itself next step.
      const msg = `Input for ${toolName} failed validation: ${parsedInput.error.issues[0]?.message}`;
      ctx.failures.push(msg);
      emit(makeEvent("tool_error", `${toolName} rejected`, undefined, msg));
      terminated = shouldTerminate(ctx, decision);
      continue;
    }

    /* -- 3. Execute, validate output, fold into context. ---------------- */
    emit(makeEvent("tool_start", toolName, decision.reason));
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
      emit(makeEvent("tool_result", toolName, undefined, describeResult(toolName, parsedOutput.data)));
    } catch (err) {
      ctx.failures.push(`${toolName} failed: ${String(err)}`);
      emit(makeEvent("tool_error", `${toolName} failed`, undefined, String(err)));
    }

    /* -- 4. Bounded exit check. ------------------------------------------ */
    terminated = shouldTerminate(ctx, decision);
    if (terminated && ctx.steps >= AGENT_LIMITS.maxSteps) {
      emit(makeEvent("error", "Step limit reached", `Stopped after ${ctx.steps} steps (cap: ${AGENT_LIMITS.maxSteps}).`));
    }
  }

  return {
    topic: ctx.topic,
    selectedPost: ctx.selectedPost,
    gap: ctx.gap,
    rules: ctx.rules,
    drafts: ctx.drafts,
    dataSource: ctx.dataSource,
    steps: ctx.steps,
  };
}
