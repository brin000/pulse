/**
 * GET /api/cron/monitor — the scheduled monitoring entry point.
 *
 * Triggered daily by Vercel Cron (vercel.json) with the platform convention
 * `Authorization: Bearer ${CRON_SECRET}`. For each enabled topic subscription
 * it runs the same agent loop the cockpit uses — not streamed, events are
 * collected and persisted with the run (source "cron") for history replay.
 *
 * Cost guardrails (docs/adr/0004-scheduled-monitoring.md), two layers:
 *  1. Daily budget: at most AGENT_LIMITS.maxDailyCronRuns cron runs per UTC
 *     day across all topics — the hard ceiling on scheduled spend.
 *  2. Batch cap: at most AGENT_LIMITS.maxTopicsPerCronRun topics per
 *     invocation. Topics run sequentially inside this route's maxDuration,
 *     so an unbounded batch would hit the platform timeout mid-run; capped
 *     topics are processed oldest-last_run_at-first, so the remainder simply
 *     leads the queue on the next scheduled tick.
 *
 * Dedup, two mechanisms:
 *  - Replies: each topic's previously recommended post ids (seen_posts) are
 *    injected as the run's exclusion set, filtered inside search_threads
 *    BEFORE quality scoring — the cron can never recommend the same thread
 *    twice. Hacker News ids carry an "hn-" prefix, so the set is
 *    collision-free across platforms.
 *  - Standalone posts: a post suggestion has no upstream thread id to
 *    exclude, so without a guard a post-goal topic would get a near-identical
 *    suggestion every day. A synthetic seen_posts row records the last
 *    suggestion per topic; within POST_SUGGESTION_COOLDOWN_MS, post-goal
 *    topics are skipped before the run even starts (saving the budget), and
 *    auto-goal runs that pivot to a standalone post stay silent.
 *
 * Notifications carry a quality gate: only a successful run that actually
 * produced something (drafts or a standalone post) creates an inbox row and
 * a best-effort email. Failures and empty runs stay silent.
 */
import { runAgent } from "@/lib/agent/orchestrator";
import type { RunGoal } from "@/lib/agent/schemas";
import type { RunResult, TimelineEvent } from "@/lib/agent/types";
import { AGENT_LIMITS, isMockLlm } from "@/lib/config";
import {
  addSeenPost,
  countCronRunsSince,
  createNotification,
  getLastPostSuggestionAt,
  getSeenPostIds,
  listEnabledTopicsOldestFirst,
  markPostSuggestion,
  saveRun,
  touchTopicLastRun,
} from "@/lib/db";
import { sendRunEmail } from "@/lib/notify";
import { formatCommunity } from "@/lib/platforms/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same ceiling as the interactive route: each topic is a full agent run with
// several sequential LLM calls, and one invocation processes up to
// maxTopicsPerCronRun of them back to back.
export const maxDuration = 300;

/** Per-topic line in the response summary — the cron's audit trail. */
interface TopicSummary {
  topic: string;
  goal: string;
  status: "ran" | "skipped";
  outcome?: "success" | "failed";
  /** Whether the run produced drafts or a standalone post. */
  produced?: boolean;
  /** Whether an inbox notification was created (quality gate passed). */
  notified?: boolean;
  /** Whether the optional email was actually accepted by Resend. */
  emailed?: boolean;
  skipReason?: string;
}

/**
 * How long a topic waits after a standalone post suggestion before the cron
 * may deliver another one. Suggestions are generated from the topic alone
 * (no fresh upstream thread), so consecutive ones are near-duplicates.
 */
const POST_SUGGESTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Midnight UTC today — the daily budget window boundary. */
function startOfUtcDay(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Notification copy: lead with the concrete deliverable, not "a run happened". */
function notificationContent(topic: string, result: RunResult) {
  if (result.drafts.length > 0 && result.selectedPost) {
    const p = result.selectedPost;
    return {
      title: `${result.drafts.length} new draft${result.drafts.length === 1 ? "" : "s"} for "${topic}"`,
      body: `Recommended thread in ${formatCommunity(p.platform, p.community)}: "${p.title}"`,
      headline: `Recommended thread: ${p.title}`,
      threadUrl: p.url,
    };
  }
  // Quality gate guarantees standalonePost exists on this branch.
  return {
    title: `New post suggestion for "${topic}"`,
    body: `Suggested post: "${result.standalonePost?.title ?? ""}"`,
    headline: `Suggested post: ${result.standalonePost?.title ?? ""}`,
    threadUrl: null,
  };
}

export async function GET(req: Request) {
  // Vercel Cron convention: the platform sends `Authorization: Bearer <CRON_SECRET>`.
  // An unset secret fails closed — an unauthenticated cron endpoint would let
  // anyone on the internet spend the LLM budget.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mockLlm = isMockLlm();
  const alreadyRunToday = await countCronRunsSince(startOfUtcDay());
  const topics = await listEnabledTopicsOldestFirst(AGENT_LIMITS.maxTopicsPerCronRun);

  const summaries: TopicSummary[] = [];
  let runsUsed = alreadyRunToday;

  for (const sub of topics) {
    // Re-checked per topic: the budget can run out mid-batch.
    if (runsUsed >= AGENT_LIMITS.maxDailyCronRuns) {
      summaries.push({
        topic: sub.topic,
        goal: sub.goal,
        status: "skipped",
        skipReason: `daily cron budget reached (${AGENT_LIMITS.maxDailyCronRuns} runs/day)`,
      });
      continue;
    }

    const goal = sub.goal as RunGoal;

    // Standalone post cooldown. For post-goal topics the run is skipped
    // before it starts — its only possible deliverable is on cooldown, so
    // running would burn budget on a notification we'd suppress anyway.
    // Auto-goal topics still run (they may find a reply-worthy thread); the
    // cooldown only mutes a repeated standalone-post pivot further down.
    const lastSuggestionAt = await getLastPostSuggestionAt(sub.id);
    const postCooldownActive =
      lastSuggestionAt !== null &&
      Date.now() - lastSuggestionAt < POST_SUGGESTION_COOLDOWN_MS;
    if (goal === "post" && postCooldownActive) {
      summaries.push({
        topic: sub.topic,
        goal: sub.goal,
        status: "skipped",
        skipReason: "post-suggestion cooldown (suggested within the last 7 days)",
      });
      continue;
    }

    // Threads recommended by earlier cron runs are excluded before scoring.
    const excludePostIds = await getSeenPostIds(sub.id);

    // No SSE consumer here — events are collected and persisted with the run
    // so /history/[id] can replay the cron run exactly like a manual one.
    const events: TimelineEvent[] = [];

    let result: RunResult;
    try {
      result = await runAgent(
        sub.topic,
        (event) => events.push(event),
        undefined,
        mockLlm,
        goal,
        excludePostIds,
      );
    } catch (err) {
      // A crashed run still spends budget and bumps last_run_at: retrying the
      // same broken topic every tick must not starve the healthy ones.
      runsUsed += 1;
      await touchTopicLastRun(sub.id);
      summaries.push({
        topic: sub.topic,
        goal: sub.goal,
        status: "ran",
        outcome: "failed",
        produced: false,
        notified: false,
        skipReason: `run crashed: ${String(err)}`,
      });
      continue;
    }
    runsUsed += 1;

    const runId = await saveRun({
      topic: sub.topic,
      goal,
      outcome: result.outcome,
      mockLlm,
      result,
      events,
      source: "cron",
    });

    // Remember the recommended thread so the next run can't surface it again.
    if (result.selectedPost) {
      await addSeenPost(sub.id, result.selectedPost.id);
    }
    // Start (or restart) the standalone-post cooldown for this topic.
    if (result.standalonePost) {
      await markPostSuggestion(sub.id);
    }
    await touchTopicLastRun(sub.id);

    // Quality gate: notify only when the run actually produced something.
    const produced =
      result.outcome === "success" &&
      (result.drafts.length > 0 || result.standalonePost !== null);

    // Auto-goal run pivoted to a standalone post while one was already
    // suggested recently: deliverable is a near-duplicate, stay silent.
    const mutedByCooldown =
      postCooldownActive && result.drafts.length === 0 && result.standalonePost !== null;

    let notified = false;
    let emailed = false;
    if (produced && runId && !mutedByCooldown) {
      const content = notificationContent(sub.topic, result);
      notified =
        (await createNotification({
          runId,
          topicId: sub.id,
          title: content.title,
          body: content.body,
        })) !== null;
      // Best-effort mirror; failure is logged inside and never propagates.
      emailed = await sendRunEmail({
        topic: sub.topic,
        runId,
        headline: content.headline,
        threadUrl: content.threadUrl,
      });
    }

    summaries.push({
      topic: sub.topic,
      goal: sub.goal,
      status: "ran",
      outcome: result.outcome,
      produced,
      notified,
      emailed,
      ...(mutedByCooldown
        ? { skipReason: "notification muted: post-suggestion cooldown" }
        : {}),
    });
  }

  return Response.json({
    mockLlm,
    dailyBudget: {
      limit: AGENT_LIMITS.maxDailyCronRuns,
      // Infinity (DB down → fail closed) is not valid JSON; report it as a string.
      usedToday: Number.isFinite(runsUsed) ? runsUsed : "unknown (database unavailable)",
    },
    batchLimit: AGENT_LIMITS.maxTopicsPerCronRun,
    topics: summaries,
  });
}
