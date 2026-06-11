/**
 * Platform abstraction (Phase 5).
 *
 * A PlatformAdapter is the single seam between the agent core and any
 * discussion platform (Reddit today, Hacker News next). The agent tools call
 * adapter methods instead of platform clients directly, so adding a platform
 * means writing one adapter — not touching the orchestrator, schemas or UI.
 *
 * The method signatures mirror the existing Reddit client exactly: this is a
 * pure structural refactor, so the interface describes what the code already
 * does rather than speculating about future needs.
 */
import type { CommentSummary, PostSummary } from "@/lib/agent/schemas";

/** Platforms known to Pulse. Reddit only until P5-2 adds Hacker News. */
export type PlatformId = "reddit";

/** Search result with provenance — "mock" is surfaced as a badge in the UI. */
export interface ThreadSearchResult {
  posts: PostSummary[];
  source: "live" | "mock";
}

/** Comment fetch result with the same live/mock provenance label. */
export interface ThreadCommentsResult {
  comments: CommentSummary[];
  source: "live" | "mock";
}

export interface PlatformAdapter {
  id: PlatformId;
  /** Human-readable platform name, e.g. "Reddit". */
  displayName: string;
  /**
   * The curated community whitelist for this platform (subreddits for Reddit).
   * Deliberately small — see docs/adr/0002-curated-subreddit-whitelist.md.
   */
  communities: readonly string[];
  /**
   * Search the given whitelisted communities for recent threads matching the
   * keywords. Implementations must compress results to PostSummary and fall
   * back to mock data on failure rather than throwing.
   */
  searchThreads(
    keywords: string[],
    communities: string[],
  ): Promise<ThreadSearchResult>;
  /** Fetch and compress the top comments of a thread by its platform post id. */
  getComments(postId: string): Promise<ThreadCommentsResult>;
  /**
   * Curated tone/rule hints for a community (the platform-specific knowledge
   * behind the `check_subreddit_rules` tool). Returns [] for unknown values.
   */
  communityNorms(community: string): string[];
  /** Display form of a community name, e.g. "webdev" -> "r/webdev". */
  formatCommunity(community: string): string;
}
