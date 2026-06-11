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
 * Dedup: each topic's previously recommended post ids (seen_posts) are
 * injected as the run's exclusion set, filtered inside search_reddit BEFORE
 * quality scoring — the cron can never recommend the same thread twice.
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
  getSeenPostIds,
  listEnabledTopicsOldestFirst,
  saveRun,
  touchTopicLastRun,
} from "@/lib/db";
import { sendRunEmail } from "@/lib/notify";

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

/** Midnight UTC today — the daily budget window boundary. */
function startOfUtcDay(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Notification copy: lead with the concrete deliverable, not "a run happened". */
function notificationContent(topic: string, result: RunResult) {
  if (result.drafts.length > 0 && result.selectedPost) {
    return {
      title: `${result.drafts.length} new draft${result.drafts.length === 1 ? "" : "s"} for "${topic}"`,
      body: `Recommended thread in r/${result.selectedPost.subreddit}: "${result.selectedPost.title}"`,
      headline: `Recommended thread: ${result.selectedPost.title}`,
      threadUrl: result.selectedPost.url,
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

    // Threads recommended by earlier cron runs are excluded before scoring.
    const excludePostIds = await getSeenPostIds(sub.id);

    // No SSE consumer here — events are collected and persisted with the run
    // so /history/[id] can replay the cron run exactly like a manual one.
    const events: TimelineEvent[] = [];
    const goal = sub.goal as RunGoal;

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
    await touchTopicLastRun(sub.id);

    // Quality gate: notify only when the run actually produced something.
    const produced =
      result.outcome === "success" &&
      (result.drafts.length > 0 || result.standalonePost !== null);

    let notified = false;
    let emailed = false;
    if (produced && runId) {
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
