/**
 * Hacker News community knowledge.
 *
 * HN has no subreddits, so Pulse treats its sections as communities: regular
 * stories, Ask HN and Show HN (docs/adr/0005-multi-platform.md). Each maps
 * onto an Algolia tag, which keeps search precise without scraping.
 *
 * Like the Reddit counterpart, this module is dependency-free on purpose:
 * Zod schemas and client components (TopicForm) import it, so it must never
 * pull in server-only fetch code.
 */

/** The HN "communities": sections, since HN has no sub-forums. */
export const HN_COMMUNITIES = ["story", "ask-hn", "show-hn"] as const;

export type HnCommunity = (typeof HN_COMMUNITIES)[number];

/** Pulse community name → Algolia search tag. */
export const HN_COMMUNITY_TAGS: Record<HnCommunity, string> = {
  story: "story",
  "ask-hn": "ask_hn",
  "show-hn": "show_hn",
};

/** Display labels per section, used by formatHnCommunity below. */
const HN_COMMUNITY_LABELS: Record<HnCommunity, string> = {
  story: "Story",
  "ask-hn": "Ask HN",
  "show-hn": "Show HN",
};

/**
 * Curated tone hints per section — a local summary of HN culture and the
 * spirit of the site guidelines, same approach as the subreddit rule hints.
 * HN punishes promotional tone harder than any subreddit, so every section
 * leads with substance-over-promotion.
 */
export const HN_NORM_HINTS: Record<HnCommunity, string[]> = {
  story: [
    "Substance over promotion: comments that read like marketing get flagged fast.",
    "Technical depth is the currency; vague claims get challenged immediately.",
    "Be curious and factual — the HN guidelines ask for conversation, not point-scoring.",
  ],
  "ask-hn": [
    "Answer the actual question from first-hand experience; war stories beat advice.",
    "Concrete numbers, trade-offs and post-mortems are what gets upvoted.",
    "Plugging your product in an answer is only tolerated when it is the direct answer.",
  ],
  "show-hn": [
    "Show HN is for things people can try — lead with what it does, not the pitch.",
    "Be upfront about limitations; HN respects honest scope more than polish.",
    "Engage with critical feedback in good faith — defensiveness kills a thread.",
  ],
};

/**
 * Display form of an HN community, e.g. "ask-hn" -> "HN · Ask HN".
 * Pure function so client components can render community names without
 * importing the (server-side) adapter.
 */
export function formatHnCommunity(community: string): string {
  const label = HN_COMMUNITY_LABELS[community as HnCommunity] ?? community;
  return `HN · ${label}`;
}
