# Scheduled Topic Monitoring with Dedup and Budget Guardrails

Pulse will monitor subscribed topics on a daily Vercel Cron schedule (`GET /api/cron/monitor`, authenticated with `Authorization: Bearer ${CRON_SECRET}`). Each enabled subscription re-runs the same agent loop the cockpit uses, with three additions: a per-topic exclusion set deduplicates recommendations, two stacked budget guardrails cap scheduled spend, and a quality gate decides whether a run becomes a notification (in-app inbox row, plus an optional best-effort email via the Resend REST API called with plain `fetch` — no SDK dependency for one POST endpoint).

## Considered Options

- Dedup by filtering recommendations after the run: simpler, but the agent would keep scoring and selecting the same winning thread, then have nothing left to show — wasted LLM calls and a confusing "found nothing" result.
- Dedup before scoring (chosen): recommended post ids are persisted per topic (`seen_posts`, composite `topic_id + post_id` key) and injected into the run as `AgentContext.excludePostIds`; the `search_reddit` executor drops them before `evaluate_result_quality` ever sees the posts, so an already-recommended thread structurally cannot win again.
- One budget guardrail vs two (chosen: two): a daily ceiling alone (`maxDailyCronRuns`, 20/UTC day across all topics) caps cost but lets a single invocation run unbounded topics into the platform `maxDuration`; a per-invocation cap alone (`maxTopicsPerCronRun`, 5, oldest `last_run_at` first) bounds the timeout but not the daily spend. Stacked, cost and runtime are both bounded; topics beyond the batch cap simply lead the queue at the next tick, so nothing starves.
- Notify on every cron run vs a quality gate (chosen: gate): only a successful run that produced drafts or a standalone post creates a notification. Failures and empty runs are still persisted (`runs.source = 'cron'`) for the history page, but they never page the user — the inbox stays a signal channel, not a log.

## Consequences

Subscriptions and notifications follow the persistence policy from ADR-0003: every DB helper swallows errors and degrades to a harmless fallback. The one deliberate exception is the budget counter — when the database is unreachable the cron *fails closed* (treats the budget as spent) because an unverifiable budget must not be spendable. The `runs` table gains a `source` column; since `CREATE TABLE IF NOT EXISTS` cannot alter an existing table, bootstrap issues an additive `ALTER TABLE ... ADD COLUMN` wrapped in try/catch — still no migration tooling, per ADR-0003's "revisit when changes stop being trivially additive".

On serverless, the cron invocation shares one function timeout with all the topic runs inside it; the batch cap is what keeps that safe, and a missed tick (cold start, timeout) self-heals because topic ordering is oldest-run-first. Email remains strictly best-effort: configuration absent → skipped with a log line, Resend failure → logged, never affecting the run, the notification row, or the cron response.
