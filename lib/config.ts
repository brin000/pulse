/**
 * Central product configuration for the Pulse MVP.
 *
 * See docs/adr/0002-curated-subreddit-whitelist.md: the MVP deliberately
 * searches a small curated subreddit set instead of all of Reddit, which keeps
 * demo quality stable and result evaluation consistent. Subreddit discovery is
 * designed to become an agent decision later.
 */

/** The curated subreddit set. `as const` lets TypeScript and Zod constrain tool inputs. */
export const SUBREDDIT_WHITELIST = [
  "webdev",
  "nextjs",
  "SideProject",
  "indiehackers",
  "SaaS",
  "artificial",
  "LocalLLaMA",
] as const;

export type Subreddit = (typeof SUBREDDIT_WHITELIST)[number];

/**
 * Local tone/rule hints per subreddit (MVP stand-in for live rule fetching).
 * The whitelist is small, so a maintained local summary is more reliable than
 * scraping subreddit rules at runtime. Used by the `check_subreddit_rules` tool.
 */
export const SUBREDDIT_RULE_HINTS: Record<Subreddit, string[]> = {
  webdev: [
    "Avoid low-effort self-promotion.",
    "Be specific and technical; show working knowledge.",
  ],
  nextjs: [
    "Keep replies implementation-focused.",
    "Avoid generic framework hot takes; cite concrete APIs or behavior.",
  ],
  SideProject: [
    "Founder context is welcome.",
    "Avoid sounding like an ad; be transparent if mentioning your own project.",
  ],
  indiehackers: [
    "Share lessons and numbers, not pitches.",
    "Personal experience is valued over advice without context.",
  ],
  SaaS: [
    "Focus on business or product substance.",
    "Self-promotion is tolerated only when the thread explicitly invites it.",
  ],
  artificial: [
    "Stay factual about model capabilities; avoid hype language.",
    "Link claims to something verifiable when possible.",
  ],
  LocalLLaMA: [
    "Technical depth is expected; hand-wavy claims get called out.",
    "Benchmarks and configs are appreciated.",
  ],
};

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
