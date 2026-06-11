/**
 * Reddit-specific community knowledge: the curated subreddit whitelist and
 * per-subreddit norm hints.
 *
 * See docs/adr/0002-curated-subreddit-whitelist.md: the MVP deliberately
 * searches a small curated subreddit set instead of all of Reddit, which keeps
 * demo quality stable and result evaluation consistent. Subreddit discovery is
 * designed to become an agent decision later.
 *
 * This module is dependency-free on purpose: it is imported by Zod schemas
 * and client components (TopicForm), so it must never pull in server-only
 * code like the OAuth client.
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
 * Display form of a subreddit, e.g. "webdev" -> "r/webdev".
 * Pure function so client components can render community names without
 * importing the (server-side) adapter.
 */
export function formatRedditCommunity(community: string): string {
  return `r/${community}`;
}

/**
 * Local tone/rule hints per subreddit (MVP stand-in for live rule fetching).
 * The whitelist is small, so a maintained local summary is more reliable than
 * scraping subreddit rules at runtime. Exposed via redditAdapter.communityNorms.
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
