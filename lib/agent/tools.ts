/**
 * Tool registry: every tool the agent can call, with its executor.
 *
 * Each tool has a single responsibility. Inputs/outputs are validated by the
 * orchestrator against the Zod schemas in schemas.ts — executors can therefore
 * trust their (already validated) inputs and focus on doing one thing well.
 *
 * Two tools are LLM-backed (`evaluate_content_gap`, `draft_comment_reply`).
 * In mock mode they switch to deterministic implementations so the whole loop
 * runs without an API key. `evaluate_result_quality` is intentionally pure
 * code: a transparent scoring heuristic the agent reacts to, not a black box.
 */
import { AGENT_LIMITS, SUBREDDIT_RULE_HINTS, isMockLlm } from "@/lib/config";
import {
  contentGapSchema,
  draftSchema,
  type ContentGap,
  type Draft,
  type PostSummary,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from "@/lib/agent/schemas";
import type { AgentContext } from "@/lib/agent/types";
import { getPostComments, searchReddit } from "@/lib/reddit/client";
import { DRAFTING_POLICY, generateStructured } from "@/lib/agent/llm";
import { z } from "zod";

/** Executor signature: validated input + current context → tool output. */
type ToolExecutor<T extends ToolName> = (
  input: ToolInput<T>,
  ctx: AgentContext,
) => Promise<ToolOutput<T>>;

/**
 * Resolve a post the model referenced by id; throws a clear error if stale.
 * Checks the selected post too: a retried search may have evicted it from
 * `ctx.posts` while it remains the thread the run is committed to.
 */
function requirePost(ctx: AgentContext, postId: string): PostSummary {
  const post = [...ctx.posts, ctx.selectedPost].find((p) => p?.id === postId);
  if (!post) throw new Error(`Post "${postId}" is not in the current context`);
  return post;
}

/* ------------------------------------------------------------------ */
/* 1. search_reddit                                                     */
/* ------------------------------------------------------------------ */

const execSearchReddit: ToolExecutor<"search_reddit"> = async (input) => {
  const { posts, source } = await searchReddit(input.keywords, input.subreddits);
  return { posts, source };
};

/* ------------------------------------------------------------------ */
/* 2. evaluate_result_quality (pure heuristic — explainable on purpose) */
/* ------------------------------------------------------------------ */

const execEvaluateQuality: ToolExecutor<"evaluate_result_quality"> = async (
  _input,
  ctx,
) => {
  // Scores the posts already in context — the model never echoes data back.
  if (ctx.posts.length === 0) {
    return {
      score: 0,
      acceptable: false,
      bestPostId: null,
      reasoning: "No posts to evaluate. The search returned nothing.",
    };
  }

  // Score each post on recency (the "discussion window") and engagement.
  // A thread older than ~48h is usually too cold to join meaningfully.
  const scored = ctx.posts.map((p) => {
    const recency = Math.max(0, 1 - p.ageHours / 48); // 1 = brand new, 0 = 48h+
    const engagement = Math.min(1, (p.score + p.numComments * 3) / 200);
    return { post: p, score: recency * 0.6 + engagement * 0.4 };
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const score = Number(best.score.toFixed(2));
  const acceptable = score >= AGENT_LIMITS.qualityThreshold;
  return {
    score,
    acceptable,
    bestPostId: best.post.id,
    reasoning: acceptable
      ? `Best candidate "${best.post.title.slice(0, 60)}..." is ${Math.round(
          best.post.ageHours,
        )}h old with ${best.post.numComments} comments, still active enough to join.`
      : `Top result only scored ${score} (threshold ${AGENT_LIMITS.qualityThreshold}); results are too old or too quiet.`,
  };
};

/* ------------------------------------------------------------------ */
/* 3. get_post_comments                                                 */
/* ------------------------------------------------------------------ */

const execGetComments: ToolExecutor<"get_post_comments"> = async (input, ctx) => {
  requirePost(ctx, input.postId);
  const { comments, source } = await getPostComments(input.postId);
  return { comments, source };
};

/* ------------------------------------------------------------------ */
/* 4. evaluate_content_gap (LLM-backed; deterministic in mock mode)     */
/* ------------------------------------------------------------------ */

const execEvaluateGap: ToolExecutor<"evaluate_content_gap"> = async (input, ctx) => {
  const post = requirePost(ctx, input.postId);

  if (isMockLlm()) {
    // Deterministic gap analysis keyed off what mock comments already cover.
    return {
      coveredAngles: [
        "Stopping conditions are the hard part of agent loops",
        "Raw API responses blow the token budget",
      ],
      missingAngles: [
        "How runtime-side validation (not prompts) keeps tool calls safe",
        "Showing the agent's reasoning per step instead of a spinner",
      ],
      recommendedAngle:
        "Concrete walk-through of a small orchestrator: schema-validated decisions, bounded retries, and a streamed timeline of why each step happened",
    };
  }

  // Real mode: ask the model, constrained to the ContentGap schema.
  const gap: ContentGap = await generateStructured({
    schema: contentGapSchema,
    system:
      "You analyze a Reddit discussion and identify which useful angles are already covered and what is genuinely missing. Be specific; avoid generic angles.",
    prompt: [
      `Topic the user cares about: ${ctx.topic}`,
      `Thread title: ${post.title}`,
      `Thread snippet: ${post.snippet}`,
      `Top comments:`,
      ...ctx.comments.map((c) => `- (${c.score} pts) ${c.snippet}`),
      ``,
      `List covered angles, missing angles, and recommend the single best angle for a reply that adds value.`,
    ].join("\n"),
  });
  return gap;
};

/* ------------------------------------------------------------------ */
/* 5. check_subreddit_rules (curated local hints by design)             */
/* ------------------------------------------------------------------ */

const execCheckRules: ToolExecutor<"check_subreddit_rules"> = async (input) => {
  return {
    subreddit: input.subreddit,
    hints: SUBREDDIT_RULE_HINTS[input.subreddit],
  };
};

/* ------------------------------------------------------------------ */
/* 6. draft_comment_reply (LLM-backed; deterministic in mock mode)      */
/* ------------------------------------------------------------------ */

const execDraftReply: ToolExecutor<"draft_comment_reply"> = async (input, ctx) => {
  const post = requirePost(ctx, input.postId);
  const hints = ctx.rules?.hints ?? [];

  if (isMockLlm()) {
    // Three tones, same angle — mirrors what the live drafter produces.
    const drafts: Draft[] = [
      {
        tone: "practical",
        text: `The loop itself is the easy part. What made the difference for me was moving control out of the prompt and into the runtime. Each step the model returns one structured decision (action + tool + reason), the runtime validates it against a schema before anything executes, and a bounded retry/termination policy decides whether to continue. Once the "why" of each step is streamed to the UI, debugging stops being guesswork.`,
        selfCheck: { toneMatch: true, useful: true, spamRisk: "low" },
      },
      {
        tone: "experience-based",
        text: `I went through exactly this while building a small agent recently. My first version was a while-loop around completions and it either ran forever or quit too early. What fixed it: schema-validated decisions (the model proposes, the runtime disposes), explicit termination conditions, and compressing every tool result before it re-enters context. Happy to share more details on the termination logic if useful.`,
        selfCheck: { toneMatch: true, useful: true, spamRisk: "low" },
      },
      {
        tone: "curious",
        text: `Genuine question for people running agents in production: where do you draw the line between letting the model decide and hard-coding the policy? I ended up validating every tool call twice (SDK schema + runtime boundary) and capping retries, but I'm curious whether others trust the model with more of the loop.`,
        selfCheck: { toneMatch: true, useful: true, spamRisk: "low" },
      },
    ];
    return { drafts };
  }

  // Real mode: schema-constrained drafting with the no-stealth-marketing policy.
  const result = await generateStructured({
    schema: z.object({ drafts: z.array(draftSchema).min(2).max(3) }),
    system: DRAFTING_POLICY,
    prompt: [
      `Write 2-3 Reddit comment reply drafts (different tones: practical / experience-based / curious).`,
      `Target subreddit: r/${post.subreddit}`,
      `Subreddit norms: ${hints.join(" ")}`,
      `Thread title: ${post.title}`,
      `Thread snippet: ${post.snippet}`,
      `Top comments already in the thread:`,
      ...ctx.comments.map((c) => `- ${c.snippet}`),
      ``,
      `Angle to take (fills the content gap): ${input.angle}`,
      `Each draft must read like a real human comment, be self-contained, and pass your own self-check for tone match, usefulness, and spam risk.`,
    ].join("\n"),
  });
  return result;
};

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export const toolExecutors: { [K in ToolName]: ToolExecutor<K> } = {
  search_reddit: execSearchReddit,
  evaluate_result_quality: execEvaluateQuality,
  get_post_comments: execGetComments,
  evaluate_content_gap: execEvaluateGap,
  check_subreddit_rules: execCheckRules,
  draft_comment_reply: execDraftReply,
};
