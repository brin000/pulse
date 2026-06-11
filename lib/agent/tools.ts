/**
 * Tool registry: every tool the agent can call, with its executor.
 *
 * Each tool has a single responsibility. Inputs/outputs are validated by the
 * orchestrator against the Zod schemas in schemas.ts — executors can therefore
 * trust their (already validated) inputs and focus on doing one thing well.
 *
 * Platform routing happens here: search/norms tools carry a `platform` id in
 * their input and resolve the matching adapter via getPlatform; comment
 * fetching routes by the platform already recorded on the post in context.
 *
 * Two tools are LLM-backed (`evaluate_content_gap`, `draft_comment_reply`).
 * In mock mode they switch to deterministic implementations so the whole loop
 * runs without an API key. `evaluate_result_quality` is intentionally pure
 * code: a transparent scoring heuristic the agent reacts to, not a black box.
 */
import { AGENT_LIMITS } from "@/lib/config";
import {
  contentGapSchema,
  draftSchema,
  standalonePostContentSchema,
  type ContentGap,
  type Draft,
  type PostSummary,
  type StandalonePost,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from "@/lib/agent/schemas";
import type { AgentContext } from "@/lib/agent/types";
import { getPlatform } from "@/lib/platforms";
import { formatCommunity, PLATFORM_LABELS } from "@/lib/platforms/format";
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
/* 1. search_threads                                                    */
/* ------------------------------------------------------------------ */

const execSearchThreads: ToolExecutor<"search_threads"> = async (input, ctx) => {
  // The platform id was validated (and its communities whitelist-checked)
  // by the input schema, so routing through the registry is safe here.
  const { posts, source } = await getPlatform(input.platform).searchThreads(
    input.keywords,
    input.communities,
  );
  // Cron dedup happens HERE — before evaluate_result_quality ever sees the
  // posts — so an already-recommended thread can't win the scoring and force
  // a "best candidate was excluded" special case downstream. Platform id
  // prefixes ("hn-") keep the exclusion set collision-free across platforms.
  const excluded = new Set(ctx.excludePostIds ?? []);
  return {
    posts: excluded.size > 0 ? posts.filter((p) => !excluded.has(p.id)) : posts,
    source,
  };
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
/* 3. get_thread_comments                                               */
/* ------------------------------------------------------------------ */

const execGetComments: ToolExecutor<"get_thread_comments"> = async (input, ctx) => {
  // The post in context knows which platform it came from — route by that,
  // not by asking the model to repeat itself (it could drift).
  const post = requirePost(ctx, input.postId);
  const { comments, source } = await getPlatform(post.platform).getComments(post.id);
  return { comments, source };
};

/* ------------------------------------------------------------------ */
/* 4. evaluate_content_gap (LLM-backed; deterministic in mock mode)     */
/* ------------------------------------------------------------------ */

const execEvaluateGap: ToolExecutor<"evaluate_content_gap"> = async (input, ctx) => {
  const post = requirePost(ctx, input.postId);

  if (ctx.mockLlm) {
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
      "You analyze an online discussion thread and identify which useful angles are already covered and what is genuinely missing. Be specific; avoid generic angles.",
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
/* 5. check_community_norms (curated local hints by design)             */
/* ------------------------------------------------------------------ */

const execCheckNorms: ToolExecutor<"check_community_norms"> = async (input) => {
  return {
    platform: input.platform,
    community: input.community,
    hints: getPlatform(input.platform).communityNorms(input.community),
  };
};

/* ------------------------------------------------------------------ */
/* 6. draft_comment_reply (LLM-backed; deterministic in mock mode)      */
/* ------------------------------------------------------------------ */

const execDraftReply: ToolExecutor<"draft_comment_reply"> = async (input, ctx) => {
  const post = requirePost(ctx, input.postId);
  const hints = ctx.rules?.hints ?? [];

  if (ctx.mockLlm) {
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
      `Write 2-3 comment reply drafts (different tones: practical / experience-based / curious).`,
      `Target community: ${formatCommunity(post.platform, post.community)} on ${PLATFORM_LABELS[post.platform]}`,
      `Community norms: ${hints.join(" ")}`,
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
/* 7. draft_standalone_post (LLM-backed; deterministic in mock mode)    */
/* ------------------------------------------------------------------ */

const execDraftStandalonePost: ToolExecutor<"draft_standalone_post"> = async (
  input,
  ctx,
) => {
  // Norms only apply when they were fetched for the same target community.
  const hints =
    ctx.rules?.platform === input.platform && ctx.rules?.community === input.community
      ? ctx.rules.hints
      : getPlatform(input.platform).communityNorms(input.community);
  const target = formatCommunity(input.platform, input.community);

  if (ctx.mockLlm) {
    // Deterministic post mirroring what the live drafter produces: a lessons-
    // learned write-up anchored on the user's topic, no self-promotion.
    const post: StandalonePost = {
      platform: input.platform,
      community: input.community,
      title: `What I learned trying to stay on top of "${ctx.topic.slice(0, 120)}" without losing my build time`,
      body: [
        `I care about ${ctx.topic}, but keeping up with the discussions around it was eating my mornings. So I treated it like an engineering problem and want to share what actually worked.`,
        ``,
        `1. Scope beats volume. Watching a handful of communities deeply beats skimming everything. Fewer sources, better signal.`,
        `2. Decide what "worth engaging" means up front. For me: the thread is younger than ~48h and still getting comments. Everything else is archaeology.`,
        `3. Write from experience or don't write. The comments that landed were the ones where I shared a concrete trade-off I had hit myself — never the summary-style ones.`,
        ``,
        `Curious how others here balance staying present in their communities with actually shipping. What's your filter for which discussions deserve your time?`,
      ].join("\n"),
      tone: "experience-based",
      selfCheck: { toneMatch: true, useful: true, spamRisk: "low" },
    };
    return { post };
  }

  // Real mode: same drafting policy as replies — an original post is still
  // judged by the community's no-stealth-marketing bar. The model drafts
  // content only; the validated target fields are stamped on afterwards.
  const result = await generateStructured({
    schema: z.object({ post: standalonePostContentSchema }),
    system: DRAFTING_POLICY,
    prompt: [
      `Write ONE original post (title + body) for ${target} on ${PLATFORM_LABELS[input.platform]}.`,
      `Community norms: ${hints.join(" ")}`,
      `Topic the user cares about: ${ctx.topic}`,
      ctx.posts.length > 0
        ? `Recent discussions in these communities (context, do not copy):\n${ctx.posts
            .map((p) => `- ${formatCommunity(p.platform, p.community)}: ${p.title}`)
            .join("\n")}`
        : `No recent threads cover this topic — the post should open that conversation.`,
      ``,
      `Angle to take: ${input.angle}`,
      `The post must read like a real community member sharing experience, invite discussion (end with a genuine question), and pass your own self-check for tone match, usefulness, and spam risk.`,
    ].join("\n"),
  });
  return {
    post: { ...result.post, platform: input.platform, community: input.community },
  };
};

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export const toolExecutors: { [K in ToolName]: ToolExecutor<K> } = {
  search_threads: execSearchThreads,
  evaluate_result_quality: execEvaluateQuality,
  get_thread_comments: execGetComments,
  evaluate_content_gap: execEvaluateGap,
  check_community_norms: execCheckNorms,
  draft_comment_reply: execDraftReply,
  draft_standalone_post: execDraftStandalonePost,
};
