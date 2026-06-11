/**
 * Every boundary between the model and the runtime is defined here as a Zod schema.
 *
 * Two-layer validation (docs/adr/0001-own-agent-orchestrator.md):
 *   1. `generateObject` generates the model's AgentDecision against `agentDecisionSchema`.
 *   2. The orchestrator validates the decision AND each tool's input/output again
 *      before anything executes. Raw model output is never trusted directly.
 */
import { z } from "zod";
// Imported from the dependency-free communities/ids modules (not the
// adapters) so the zod enums keep literal tuple types and no server code
// leaks into client bundles that import these schemas for their types.
import { PLATFORM_IDS, type PlatformId } from "@/lib/platforms/ids";
import { SUBREDDIT_WHITELIST } from "@/lib/platforms/reddit/communities";
import { HN_COMMUNITIES } from "@/lib/platforms/hackernews/communities";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                    */
/* ------------------------------------------------------------------ */

export const platformIdSchema = z.enum(PLATFORM_IDS);

/**
 * Per-platform community whitelists. A single z.enum can't express "the
 * community must belong to THIS input's platform", so the tool input schemas
 * cross-check against this table in superRefine — same double-validation
 * spirit, now platform-aware.
 */
const COMMUNITY_WHITELISTS: Record<PlatformId, readonly string[]> = {
  reddit: SUBREDDIT_WHITELIST,
  hackernews: HN_COMMUNITIES,
};

function assertCommunityOnPlatform(
  platform: PlatformId,
  community: string,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (!COMMUNITY_WHITELISTS[platform].includes(community)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `"${community}" is not a whitelisted ${platform} community (allowed: ${COMMUNITY_WHITELISTS[platform].join(", ")})`,
    });
  }
}

/**
 * What the user asked the run to produce. "auto" tries the reply pipeline
 * first and pivots to a standalone post when no joinable thread exists —
 * turning the old "search exhausted → fail" dead end into a useful output.
 */
export const runGoalSchema = z.enum(["auto", "reply", "post"]);
export type RunGoal = z.infer<typeof runGoalSchema>;

/**
 * Compressed thread/post — the only post shape the LLM ever sees.
 * `platform` defaults to "reddit" because runs persisted before P5-3 carry
 * no platform field; parsing them must keep working (history replay).
 */
export const postSummarySchema = z.object({
  id: z.string(),
  platform: platformIdSchema.default("reddit"),
  /** Community within the platform (subreddit / HN section). */
  community: z.string(),
  title: z.string(),
  /** Upvote score (Reddit) or points (HN). */
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
  "search_threads",
  "evaluate_result_quality",
  "get_thread_comments",
  "evaluate_content_gap",
  "check_community_norms",
  "draft_comment_reply",
  "draft_standalone_post",
] as const;

export const toolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof toolNameSchema>;

/**
 * Pre-P5-3 tool names → their platform-neutral successors. Persisted runs
 * keep their original events_json forever, so UI code that matches on the
 * `tool` field (Timeline icons, RunStepper progress) resolves through this
 * map instead of assuming every stored name is a current ToolName.
 */
export const LEGACY_TOOL_NAMES: Record<string, ToolName> = {
  search_reddit: "search_threads",
  get_post_comments: "get_thread_comments",
  check_subreddit_rules: "check_community_norms",
};

/** Resolve a (possibly legacy) stored tool name; undefined when unknown. */
export function canonicalToolName(tool: string | undefined): ToolName | undefined {
  if (!tool) return undefined;
  if ((TOOL_NAMES as readonly string[]).includes(tool)) return tool as ToolName;
  return LEGACY_TOOL_NAMES[tool];
}

export const toolInputSchemas = {
  search_threads: z
    .object({
      /** Which platform to search — the agent's own choice per run. */
      platform: platformIdSchema,
      /** Keywords chosen by the model; refined on retries. */
      keywords: z.array(z.string().min(1)).min(1).max(6),
      /** Constrained to the chosen platform's curated whitelist below. */
      communities: z.array(z.string().min(1)).min(1),
    })
    .superRefine((val, ctx) => {
      val.communities.forEach((community, i) =>
        assertCommunityOnPlatform(val.platform, community, ctx, ["communities", i]),
      );
    }),
  // Takes no input on purpose: the executor scores the posts already in the
  // run context. Making the model echo full post objects back would waste
  // tokens and invite lossy/hallucinated copies of real data. `.default({})`
  // also accepts a decision that omits `input` entirely.
  evaluate_result_quality: z.object({}).default({}),
  // No platform field: the post id resolves to a post already in context,
  // which carries its own platform — re-asking the model would invite drift.
  get_thread_comments: z.object({
    postId: z.string().min(1),
  }),
  evaluate_content_gap: z.object({
    postId: z.string().min(1),
  }),
  check_community_norms: z
    .object({
      platform: platformIdSchema,
      community: z.string().min(1),
    })
    .superRefine((val, ctx) =>
      assertCommunityOnPlatform(val.platform, val.community, ctx, ["community"]),
    ),
  draft_comment_reply: z.object({
    postId: z.string().min(1),
    /** Free-form drafting instruction, e.g. the recommended angle to take. */
    angle: z.string().min(1),
  }),
  draft_standalone_post: z
    .object({
      platform: platformIdSchema,
      /** Target community for the original post — whitelist-constrained. */
      community: z.string().min(1),
      /** Free-form drafting instruction, e.g. the angle the post should take. */
      angle: z.string().min(1),
    })
    .superRefine((val, ctx) =>
      assertCommunityOnPlatform(val.platform, val.community, ctx, ["community"]),
    ),
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

/**
 * Tone/rule hints for one community. `platform` defaults to "reddit" for
 * the same history-replay reason as postSummarySchema.
 */
export const communityNormsSchema = z.object({
  platform: platformIdSchema.default("reddit"),
  community: z.string(),
  hints: z.array(z.string()),
});
export type CommunityNorms = z.infer<typeof communityNormsSchema>;

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

/**
 * What the drafting LLM produces for an original post. The platform/community
 * target is stamped on by the executor (it already validated them), so the
 * model is never asked to echo routing fields back.
 */
export const standalonePostContentSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  tone: z.enum(["practical", "experience-based", "curious"]),
  selfCheck: selfCheckSchema,
});

/**
 * An original post (title + body) drafted for a target community. Defaults
 * cover pre-P5-3 persisted posts, which carried no target fields (the UI
 * showed the community via `rules` back then).
 */
export const standalonePostSchema = standalonePostContentSchema.extend({
  platform: platformIdSchema.default("reddit"),
  community: z.string().default(""),
});
export type StandalonePost = z.infer<typeof standalonePostSchema>;

export const toolOutputSchemas = {
  search_threads: z.object({
    posts: z.array(postSummarySchema),
    /** "live" or "mock" — surfaced in the UI so demo data is never passed off as real. */
    source: z.enum(["live", "mock"]),
  }),
  evaluate_result_quality: qualityEvaluationSchema,
  get_thread_comments: z.object({
    comments: z.array(commentSummarySchema),
    source: z.enum(["live", "mock"]),
  }),
  evaluate_content_gap: contentGapSchema,
  check_community_norms: communityNormsSchema,
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
