/**
 * decideNextAction — the only place the model influences control flow.
 *
 * Real mode: Vercel AI SDK `generateObject` produces an AgentDecision against
 * the Zod schema (layer-1 validation). The orchestrator re-validates before
 * executing anything (layer-2). The model proposes; the runtime disposes.
 *
 * Mock mode: a deterministic state machine emits the same AgentDecision shape
 * with honest `reason`s, so the full loop (validation, SSE, UI) is exercised
 * without an API key.
 */
import { AGENT_LIMITS, SUBREDDIT_WHITELIST } from "@/lib/config";
import {
  agentDecisionSchema,
  TOOL_NAMES,
  type AgentDecision,
} from "@/lib/agent/schemas";
import type { AgentContext } from "@/lib/agent/types";
import { generateStructured } from "@/lib/agent/llm";

export async function decideNextAction(ctx: AgentContext): Promise<AgentDecision> {
  return ctx.mockLlm ? decideMock(ctx) : decideWithModel(ctx);
}

/* ------------------------------------------------------------------ */
/* Real mode                                                            */
/* ------------------------------------------------------------------ */

/**
 * Compress the working context into a short, structured state report.
 * The model sees summaries and counts — never raw Reddit payloads.
 */
function summarizeContext(ctx: AgentContext): string {
  const lines = [
    `topic: ${ctx.topic}`,
    `step: ${ctx.steps}/${AGENT_LIMITS.maxSteps}`,
    `search_attempts: ${ctx.searchAttempts}/${AGENT_LIMITS.maxSearchAttempts}`,
    `draft_attempts: ${ctx.draftAttempts}/${AGENT_LIMITS.maxDraftAttempts}`,
    `posts_in_context: ${ctx.posts.length}`,
  ];
  if (ctx.posts.length > 0) {
    lines.push(
      "posts:",
      ...ctx.posts.map(
        (p) =>
          `  - [${p.id}] r/${p.subreddit} "${p.title.slice(0, 80)}" (${Math.round(
            p.ageHours,
          )}h old, ${p.numComments} comments)`,
      ),
    );
  }
  if (ctx.quality) {
    lines.push(
      `quality: score=${ctx.quality.score} acceptable=${ctx.quality.acceptable} best=${ctx.quality.bestPostId}`,
    );
  }
  if (ctx.selectedPost) lines.push(`selected_post: ${ctx.selectedPost.id}`);
  if (ctx.comments.length > 0) lines.push(`comments_loaded: ${ctx.comments.length}`);
  if (ctx.gap) lines.push(`content_gap: ${ctx.gap.recommendedAngle}`);
  if (ctx.rules) lines.push(`rules_checked: r/${ctx.rules.subreddit}`);
  if (ctx.drafts.length > 0) lines.push(`drafts_ready: ${ctx.drafts.length}`);
  if (ctx.failures.length > 0) {
    lines.push("recent_failures:", ...ctx.failures.slice(-3).map((f) => `  - ${f}`));
  }
  return lines.join("\n");
}

async function decideWithModel(ctx: AgentContext): Promise<AgentDecision> {
  return generateStructured({
    schema: agentDecisionSchema,
    system: [
      "You are the decision core of Pulse, an agent that finds a live Reddit discussion worth joining and drafts comment replies.",
      `Available tools: ${TOOL_NAMES.join(", ")}.`,
      // The decision schema can't describe per-tool inputs, so spell them out.
      "Tool inputs: search_reddit {keywords: string[], subreddits: string[]} · evaluate_result_quality {} (scores posts already in context) · get_post_comments {postId} · evaluate_content_gap {postId} · check_subreddit_rules {subreddit} · draft_comment_reply {postId, angle}.",
      `Allowed subreddits: ${SUBREDDIT_WHITELIST.join(", ")}.`,
      "Typical flow: search_reddit -> evaluate_result_quality -> (retry search with refined keywords if low quality) -> get_post_comments on the best post -> evaluate_content_gap -> check_subreddit_rules -> draft_comment_reply -> finish.",
      "Rules:",
      "- Always include a concrete, specific `reason` — it is shown to the user live.",
      "- Retry search at most until the attempt limit; refine keywords when you do.",
      "- finish only when drafts exist; fail only when nothing useful can be produced.",
      "- input must match the chosen tool's parameters exactly.",
    ].join("\n"),
    prompt: `Current run state:\n${summarizeContext(ctx)}\n\nReturn the single next AgentDecision.`,
  });
}

/* ------------------------------------------------------------------ */
/* Mock mode: deterministic, honest, exercises every branch             */
/* ------------------------------------------------------------------ */

/** Derive search keywords from the topic; on retries, broaden the terms. */
function keywordsFor(ctx: AgentContext): string[] {
  const words = ctx.topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  if (ctx.searchAttempts === 0) return words.length > 0 ? words : ["agent"];
  // Retry: broaden by dropping the most specific (longest) keyword.
  const broadened = [...words].sort((a, b) => a.length - b.length).slice(0, 2);
  return broadened.length > 0 ? broadened : ["ai", "agent"];
}

function decideMock(ctx: AgentContext): AgentDecision {
  // 1) Need search results (first attempt, or retry after a low-quality batch).
  const needsSearch =
    ctx.posts.length === 0 || (ctx.quality !== null && !ctx.quality.acceptable);
  if (needsSearch && ctx.searchAttempts < AGENT_LIMITS.maxSearchAttempts) {
    const retrying = ctx.searchAttempts > 0;
    return {
      action: "call_tool",
      toolName: "search_reddit",
      input: { keywords: keywordsFor(ctx), subreddits: [...SUBREDDIT_WHITELIST] },
      reason: retrying
        ? `Previous results scored ${ctx.quality?.score ?? 0} (below threshold). Retrying with broader keywords.`
        : `Searching the curated subreddits for active discussions about "${ctx.topic}".`,
    };
  }

  // 2) Fresh results that haven't been scored yet.
  if (ctx.posts.length > 0 && ctx.quality === null) {
    return {
      action: "call_tool",
      toolName: "evaluate_result_quality",
      input: {},
      reason: `Scoring ${ctx.posts.length} posts on recency and engagement to find a thread still worth joining.`,
    };
  }

  // 3) Nothing usable and no retries left → fail honestly.
  if (ctx.posts.length === 0) {
    return {
      action: "fail",
      reason: "No relevant posts found after exhausting search retries.",
    };
  }

  // 4) Read the room: fetch top comments of the best candidate.
  if (ctx.comments.length === 0 && ctx.selectedPost === null) {
    const bestId = ctx.quality?.bestPostId ?? ctx.posts[0].id;
    return {
      action: "call_tool",
      toolName: "get_post_comments",
      input: { postId: bestId },
      reason: ctx.quality?.acceptable
        ? "Best candidate passed the quality bar. Reading its top comments to understand the discussion."
        : "Retries exhausted; proceeding with the strongest available thread (best effort).",
    };
  }

  // Branches 5-7 all require a committed thread. Selection can stay null in
  // edge cases (e.g. the post id vanished from context between steps), so
  // narrow it once here instead of asserting non-null in every branch.
  const selected = ctx.selectedPost;
  if (!selected) {
    return {
      action: "fail",
      reason: "Lost track of the selected thread; cannot continue the pipeline.",
    };
  }

  // 5) Find what's missing from the discussion.
  if (ctx.gap === null) {
    return {
      action: "call_tool",
      toolName: "evaluate_content_gap",
      input: { postId: selected.id },
      reason: "Comments loaded. Analyzing which useful angles are already covered and what is missing.",
    };
  }

  // 6) Check community norms before drafting.
  if (ctx.rules === null) {
    return {
      action: "call_tool",
      toolName: "check_subreddit_rules",
      input: { subreddit: selected.subreddit },
      reason: `Checking r/${selected.subreddit} tone guidelines so drafts match community norms.`,
    };
  }

  // 7) Draft replies along the recommended angle.
  if (ctx.drafts.length === 0 && ctx.draftAttempts < AGENT_LIMITS.maxDraftAttempts) {
    return {
      action: "call_tool",
      toolName: "draft_comment_reply",
      input: { postId: selected.id, angle: ctx.gap.recommendedAngle },
      reason: `Drafting replies that take the missing angle: "${ctx.gap.recommendedAngle.slice(0, 80)}...".`,
    };
  }

  // 8) Done.
  if (ctx.drafts.length > 0) {
    return {
      action: "finish",
      reason: `${ctx.drafts.length} drafts pass the self-check. Ready for human review.`,
    };
  }

  return { action: "fail", reason: "Could not produce a draft within the attempt limits." };
}
