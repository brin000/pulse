/**
 * Central product configuration for the Pulse MVP: agent loop limits and
 * runtime mode flags.
 *
 * Platform-specific knowledge (the curated subreddit whitelist and rule
 * hints) moved to lib/platforms/reddit/communities.ts in Phase 5 — each
 * platform owns its community curation behind the PlatformAdapter seam.
 */

/** Hard limits that keep the agent loop bounded and explainable. */
export const AGENT_LIMITS = {
  /** Absolute cap on orchestrator iterations — the loop can never run away. */
  maxSteps: 12,
  /** How many times the agent may retry searching with refined keywords. */
  maxSearchAttempts: 3,
  /** How many drafting rounds are allowed before we return the best effort. */
  maxDraftAttempts: 2,
  /** Quality score (0..1) a search result set must reach to be acceptable. */
  qualityThreshold: 0.55,
  /** Max posts kept after compression — keeps every LLM call token-conscious. */
  maxPostsInContext: 6,
  /** Max top comments fetched/kept per selected thread. */
  maxCommentsInContext: 8,
  /**
   * Daily budget for scheduled (cron) runs across ALL topics — the hard cost
   * ceiling. A runaway subscription list can never burn more than this many
   * agent runs (and their LLM calls) per UTC day.
   */
  maxDailyCronRuns: 20,
  /**
   * Topics processed per single cron invocation. The cron route shares the
   * platform maxDuration budget with everything else it does, and topics run
   * sequentially — capping the batch keeps one invocation safely inside the
   * timeout. Remaining topics are picked up next time (oldest last_run_at
   * first, so no topic starves).
   */
  maxTopicsPerCronRun: 5,
} as const;

/**
 * Runtime mode flags.
 *
 * Mock mode keeps the full loop runnable without an API key: the orchestrator,
 * validation and streaming paths are identical — only `decideNextAction` and
 * LLM-backed tools switch to deterministic implementations.
 */
export function isMockLlm(): boolean {
  return !process.env.ANTHROPIC_API_KEY || process.env.PULSE_MOCK === "1";
}

/**
 * Gate for spending real LLM tokens on a public deployment.
 *
 * When PULSE_LIVE_TOKEN is set, a request must present the matching token
 * (`?live=<token>` on the page → request body) to run in live mode; everyone
 * else gets the full experience in mock mode. Unset = live mode is open,
 * which is the right default for local development.
 */
export function isLiveLlmAuthorized(token: string | null | undefined): boolean {
  const gate = process.env.PULSE_LIVE_TOKEN;
  if (!gate) return true;
  return token === gate;
}

export function isMockReddit(): boolean {
  return process.env.PULSE_MOCK_REDDIT === "1";
}
