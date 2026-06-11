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
 *
 * Platform choice is part of the decision space since P5-3: the agent picks
 * Reddit or Hacker News per run based on where the topic's audience lives,
 * and explains the pick in the search step's reason.
 */
import { AGENT_LIMITS } from "@/lib/config";
import { getPlatform, PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/lib/platforms/ids";
import { formatCommunity, PLATFORM_LABELS } from "@/lib/platforms/format";
import type { Subreddit } from "@/lib/platforms/reddit/communities";
import type { HnCommunity } from "@/lib/platforms/hackernews/communities";
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
 * The model sees summaries and counts — never raw platform payloads.
 */
function summarizeContext(ctx: AgentContext): string {
  const lines = [
    `topic: ${ctx.topic}`,
    `goal: ${ctx.goal}`,
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
          `  - [${p.id}] ${formatCommunity(p.platform, p.community)} "${p.title.slice(0, 80)}" (${Math.round(
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
  if (ctx.rules) {
    lines.push(`norms_checked: ${formatCommunity(ctx.rules.platform, ctx.rules.community)}`);
  }
  if (ctx.drafts.length > 0) lines.push(`drafts_ready: ${ctx.drafts.length}`);
  if (ctx.standalonePost) lines.push(`standalone_post_ready: "${ctx.standalonePost.title.slice(0, 60)}"`);
  if (ctx.failures.length > 0) {
    lines.push("recent_failures:", ...ctx.failures.slice(-3).map((f) => `  - ${f}`));
  }
  return lines.join("\n");
}

/** "reddit: webdev, nextjs, ... · hackernews: story, ask-hn, show-hn" */
function describePlatforms(): string {
  return Object.values(PLATFORMS)
    .map((p) => `${p.id} (${p.displayName}): ${p.communities.join(", ")}`)
    .join(" · ");
}

async function decideWithModel(ctx: AgentContext): Promise<AgentDecision> {
  return generateStructured({
    schema: agentDecisionSchema,
    system: [
      "You are the decision core of Pulse, an agent that either joins a live developer discussion (on Reddit or Hacker News) with drafted replies, or drafts an original standalone post for a target community.",
      `Available tools: ${TOOL_NAMES.join(", ")}.`,
      // The decision schema can't describe per-tool inputs, so spell them out.
      "Tool inputs: search_threads {platform, keywords: string[], communities: string[]} · evaluate_result_quality {} (scores posts already in context) · get_thread_comments {postId} · evaluate_content_gap {postId} · check_community_norms {platform, community} · draft_comment_reply {postId, angle} · draft_standalone_post {platform, community, angle}.",
      `Platforms and their allowed communities: ${describePlatforms()}. Communities must belong to the platform you pass alongside them.`,
      "Before the first search, decide which platform fits the topic best: startup/founder/Show-HN-flavored topics and 'what does HN think' questions lean hackernews; framework-, webdev- and niche-community topics lean reddit. State why you picked the platform in the search step's reason. Stay on one platform unless its results are exhausted — then retrying on the other platform is a valid refinement.",
      "The run state includes `goal`, which selects the flow:",
      "- goal=reply: search_threads -> evaluate_result_quality -> (retry search with refined keywords if low quality) -> get_thread_comments on the best post -> evaluate_content_gap -> check_community_norms -> draft_comment_reply -> finish.",
      "- goal=post: optionally search_threads once for context, then pick the best-fitting platform + allowed community -> check_community_norms -> draft_standalone_post -> finish. Skip post selection, comments and gap analysis.",
      "- goal=auto: follow the reply flow first; if search retries are exhausted or no acceptable thread exists, pivot to the post flow (check_community_norms -> draft_standalone_post) instead of failing.",
      "Rules:",
      "- Always include a concrete, specific `reason` — it is shown to the user live.",
      "- Retry search at most until the attempt limit; refine keywords when you do.",
      "- finish only when drafts or a standalone post exist; fail only when nothing useful can be produced.",
      "- input must match the chosen tool's parameters exactly.",
    ].join("\n"),
    prompt: `Current run state:\n${summarizeContext(ctx)}\n\nReturn the single next AgentDecision.`,
  });
}

/* ------------------------------------------------------------------ */
/* Mock mode: deterministic, honest, exercises every branch             */
/* ------------------------------------------------------------------ */

/**
 * Deterministic platform choice, mirroring the guidance the live prompt
 * gives the model: startup/founder/Show-HN-flavored topics read as Hacker
 * News territory, everything else stays on the (larger) Reddit whitelist.
 * Stateless on purpose — derived from the topic, it is stable across steps.
 */
function pickPlatformFor(topic: string): PlatformId {
  const t = topic.toLowerCase();
  if (/\b(show\s?hn|ask\s?hn|hacker\s?news|hn|startups?|founders?|yc|y\s?combinator)\b/.test(t)) {
    return "hackernews";
  }
  return "reddit";
}

/** One-line justification of the platform pick, surfaced in search reasons. */
function platformReason(platform: PlatformId, topic: string): string {
  return platform === "hackernews"
    ? `The topic "${topic.slice(0, 60)}" has a startup/Show-HN flavor, so its audience lives on Hacker News rather than the curated subreddits.`
    : `The topic "${topic.slice(0, 60)}" fits the curated developer subreddits better than Hacker News' startup-leaning front page.`;
}

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

/**
 * Deterministic target-community choice for the standalone-post path:
 * match topic words against the chosen platform's whitelist (plus a few
 * topical aliases), with a guaranteed fallback so the choice always succeeds.
 */
function pickCommunityFor(platform: PlatformId, topic: string): string {
  const haystack = topic.toLowerCase();

  if (platform === "hackernews") {
    // Alias values keep the HnCommunity type so a typo fails compilation.
    const showHn: HnCommunity = "show-hn";
    const askHn: HnCommunity = "ask-hn";
    // Show HN wants something to demo; questions/discussions are Ask HN.
    if (/\b(show\s?hn|side\s?project|built|launch|feedback|demo)\b/.test(haystack)) {
      return showHn;
    }
    return askHn;
  }

  for (const sub of getPlatform("reddit").communities) {
    if (haystack.includes(sub.toLowerCase())) return sub;
  }
  // Alias values keep the Subreddit type so a typo here fails compilation.
  const aliases: Array<[RegExp, Subreddit]> = [
    [/\b(llm|llama|local model)/, "LocalLLaMA"],
    [/\b(ai|agent|model)/, "artificial"],
    [/\b(saas|subscription)/, "SaaS"],
    [/\b(indie|founder|launch)/, "indiehackers"],
    [/\b(side ?project|mvp)/, "SideProject"],
  ];
  for (const [pattern, sub] of aliases) {
    if (pattern.test(haystack)) return sub;
  }
  return getPlatform("reddit").communities[0];
}

/**
 * Standalone-post pipeline: (optional context search) → norms → draft → finish.
 * Entered directly for goal=post, or as the auto-goal pivot once the reply
 * search is exhausted (in that case search attempts are already spent, so the
 * context-search branch self-skips).
 */
function decideMockPost(ctx: AgentContext, pivoted: boolean): AgentDecision {
  const platformId = pickPlatformFor(ctx.topic);
  const platform = getPlatform(platformId);

  // a) One context-research search — optional by design, never retried.
  if (ctx.searchAttempts === 0) {
    return {
      action: "call_tool",
      toolName: "search_threads",
      input: {
        platform: platformId,
        keywords: keywordsFor(ctx),
        communities: [...platform.communities],
      },
      reason: `Goal is an original post. ${platformReason(platformId, ctx.topic)} Scanning its curated communities once to understand what is already being discussed.`,
    };
  }

  const target = ctx.rules?.community ?? pickCommunityFor(platformId, ctx.topic);
  const targetLabel = formatCommunity(platformId, target);

  // b) Community norms before writing anything.
  if (ctx.rules === null) {
    return {
      action: "call_tool",
      toolName: "check_community_norms",
      input: { platform: platformId, community: target },
      reason: pivoted
        ? `No joinable thread found — pivoting to an original post. ${platformReason(platformId, ctx.topic)} Checking ${targetLabel} norms before drafting.`
        : `${targetLabel} fits the topic best on ${PLATFORM_LABELS[platformId]}. Checking its tone guidelines before drafting the post.`,
    };
  }

  // c) Draft the post along a topic-derived angle.
  if (ctx.standalonePost === null && ctx.draftAttempts < AGENT_LIMITS.maxDraftAttempts) {
    return {
      action: "call_tool",
      toolName: "draft_standalone_post",
      input: {
        platform: platformId,
        community: target,
        angle: `Practical lessons and concrete trade-offs from hands-on work on ${ctx.topic}, framed to start a discussion`,
      },
      reason: `Drafting an original post for ${targetLabel} that opens the conversation instead of joining one.`,
    };
  }

  // d) Done.
  if (ctx.standalonePost) {
    return {
      action: "finish",
      reason: `Standalone post for ${targetLabel} passes the self-check. Ready for human review.`,
    };
  }

  return { action: "fail", reason: "Could not produce a standalone post within the attempt limits." };
}

function decideMock(ctx: AgentContext): AgentDecision {
  // Post goal skips the reply pipeline entirely.
  if (ctx.goal === "post") return decideMockPost(ctx, false);

  const platformId = pickPlatformFor(ctx.topic);
  const platform = getPlatform(platformId);

  // 1) Need search results (first attempt, or retry after a low-quality batch).
  const needsSearch =
    ctx.posts.length === 0 || (ctx.quality !== null && !ctx.quality.acceptable);
  if (needsSearch && ctx.searchAttempts < AGENT_LIMITS.maxSearchAttempts) {
    const retrying = ctx.searchAttempts > 0;
    return {
      action: "call_tool",
      toolName: "search_threads",
      input: {
        platform: platformId,
        keywords: keywordsFor(ctx),
        communities: [...platform.communities],
      },
      reason: retrying
        ? ctx.posts.length === 0
          ? "The last search returned no posts. Retrying with broader keywords."
          : `Previous results scored ${ctx.quality?.score ?? 0} (below threshold). Retrying with broader keywords.`
        : `${platformReason(platformId, ctx.topic)} Searching its curated communities for active discussions.`,
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

  // 3) Search exhausted with nothing to reply to. Auto pivots to an original
  //    post — the old dead end becomes a deliverable. Reply-only fails honestly.
  if (ctx.posts.length === 0) {
    if (ctx.goal === "auto") return decideMockPost(ctx, true);
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
      toolName: "get_thread_comments",
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
      toolName: "check_community_norms",
      input: { platform: selected.platform, community: selected.community },
      reason: `Checking ${formatCommunity(selected.platform, selected.community)} tone guidelines so drafts match community norms.`,
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
