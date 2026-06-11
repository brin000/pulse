/**
 * Every boundary between the model and the runtime is defined here as a Zod schema.
 *
 * Two-layer validation (docs/adr/0001-own-agent-orchestrator.md):
 *   1. `generateObject` generates the model's AgentDecision against `agentDecisionSchema`.
 *   2. The orchestrator validates the decision AND each tool's input/output again
 *      before anything executes. Raw model output is never trusted directly.
 */
import { z } from "zod";
// Imported from the dependency-free communities module (not the adapter) so
// the zod enum keeps the literal tuple type and no server code leaks here.
import { SUBREDDIT_WHITELIST } from "@/lib/platforms/reddit/communities";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                    */
/* ------------------------------------------------------------------ */

export const subredditSchema = z.enum(SUBREDDIT_WHITELIST);

/**
 * What the user asked the run to produce. "auto" tries the reply pipeline
 * first and pivots to a standalone post when no joinable thread exists —
 * turning the old "search exhausted → fail" dead end into a useful output.
 */
export const runGoalSchema = z.enum(["auto", "reply", "post"]);
export type RunGoal = z.infer<typeof runGoalSchema>;

/** Compressed Reddit post — the only post shape the LLM ever sees. */
export const postSummarySchema = z.object({
  id: z.string(),
  subreddit: subredditSchema,
  title: z.string(),
  /** Reddit upvote score. */
  score: z.number(),
  numComments: z.number(),
  /** Hours since the post was created — drives "still active enough to join". */
  ageHours: z.number(),
  url: z.string(),
  /** Short body preview; full bodies are intentionally dropped to save tokens. */
  snippet: z.string(),
});
export type PostSummary = z.infer<typeof postSummarySchema>;

/** Compressed top-level comment. */
export const commentSummarySchema = z.object({
  author: z.string(),
  score: z.number(),
  snippet: z.string(),
});
export type CommentSummary = z.infer<typeof commentSummarySchema>;

/* ------------------------------------------------------------------ */
/* Tool registry: names, inputs, outputs                                */
/* ------------------------------------------------------------------ */

export const TOOL_NAMES = [
  "search_reddit",
  "evaluate_result_quality",
  "get_post_comments",
  "evaluate_content_gap",
  "check_subreddit_rules",
  "draft_comment_reply",
  "draft_standalone_post",
] as const;

export const toolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolInputSchemas = {
  search_reddit: z.object({
    /** Keywords chosen by the model; refined on retries. */
    keywords: z.array(z.string().min(1)).min(1).max(6),
    /** Constrained to the curated whitelist — invalid subreddits cannot pass. */
    subreddits: z.array(subredditSchema).min(1),
  }),
  // Takes no input on purpose: the executor scores the posts already in the
  // run context. Making the model echo full post objects back would waste
  // tokens and invite lossy/hallucinated copies of real data. `.default({})`
  // also accepts a decision that omits `input` entirely.
  evaluate_result_quality: z.object({}).default({}),
  get_post_comments: z.object({
    postId: z.string().min(1),
  }),
  evaluate_content_gap: z.object({
    postId: z.string().min(1),
  }),
  check_subreddit_rules: z.object({
    subreddit: subredditSchema,
  }),
  draft_comment_reply: z.object({
    postId: z.string().min(1),
    /** Free-form drafting instruction, e.g. the recommended angle to take. */
    angle: z.string().min(1),
  }),
  draft_standalone_post: z.object({
    /** Target community for the original post — whitelist-constrained. */
    subreddit: subredditSchema,
    /** Free-form drafting instruction, e.g. the angle the post should take. */
    angle: z.string().min(1),
  }),
} as const;

export const qualityEvaluationSchema = z.object({
  /** 0..1 — combination of relevance, recency and engagement. */
  score: z.number().min(0).max(1),
  acceptable: z.boolean(),
  /** Post the evaluator considers the strongest candidate (if any). */
  bestPostId: z.string().nullable(),
  reasoning: z.string(),
});
export type QualityEvaluation = z.infer<typeof qualityEvaluationSchema>;

export const contentGapSchema = z.object({
  coveredAngles: z.array(z.string()),
  missingAngles: z.array(z.string()).min(1),
  /** The single angle the drafts should take. */
  recommendedAngle: z.string(),
});
export type ContentGap = z.infer<typeof contentGapSchema>;

export const subredditRulesSchema = z.object({
  subreddit: subredditSchema,
  hints: z.array(z.string()),
});
export type SubredditRules = z.infer<typeof subredditRulesSchema>;

/** Self-check the drafter runs on its own output (shown in the UI as chips). */
export const selfCheckSchema = z.object({
  toneMatch: z.boolean(),
  useful: z.boolean(),
  spamRisk: z.enum(["low", "medium", "high"]),
});
export type SelfCheck = z.infer<typeof selfCheckSchema>;

export const draftSchema = z.object({
  tone: z.enum(["practical", "experience-based", "curious"]),
  text: z.string().min(1),
  selfCheck: selfCheckSchema,
});
export type Draft = z.infer<typeof draftSchema>;

/** An original post (title + body) drafted for a target subreddit. */
export const standalonePostSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  tone: z.enum(["practical", "experience-based", "curious"]),
  selfCheck: selfCheckSchema,
});
export type StandalonePost = z.infer<typeof standalonePostSchema>;

export const toolOutputSchemas = {
  search_reddit: z.object({
    posts: z.array(postSummarySchema),
    /** "live" or "mock" — surfaced in the UI so demo data is never passed off as real. */
    source: z.enum(["live", "mock"]),
  }),
  evaluate_result_quality: qualityEvaluationSchema,
  get_post_comments: z.object({
    comments: z.array(commentSummarySchema),
    source: z.enum(["live", "mock"]),
  }),
  evaluate_content_gap: contentGapSchema,
  check_subreddit_rules: subredditRulesSchema,
  draft_comment_reply: z.object({
    drafts: z.array(draftSchema).min(1).max(3),
  }),
  draft_standalone_post: z.object({
    post: standalonePostSchema,
  }),
} as const;

export type ToolInput<T extends ToolName> = z.infer<(typeof toolInputSchemas)[T]>;
export type ToolOutput<T extends ToolName> = z.infer<(typeof toolOutputSchemas)[T]>;

/* ------------------------------------------------------------------ */
/* AgentDecision: the only thing the model returns each step            */
/* ------------------------------------------------------------------ */

/**
 * The model never returns free-form JSON. Each step it produces exactly one
 * AgentDecision. `reason` is required — it drives the streaming timeline so
 * users see WHY the agent chose each action, not just what it did.
 */
export const agentDecisionSchema = z.object({
  action: z.enum(["call_tool", "finish", "fail"]),
  toolName: toolNameSchema.optional(),
  /** Tool arguments; validated again against the specific tool's input schema. */
  input: z.unknown().optional(),
  reason: z.string().min(1),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
