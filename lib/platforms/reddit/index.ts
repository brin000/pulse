/**
 * Reddit's PlatformAdapter: wraps the existing client (client.ts) and the
 * curated community knowledge (communities.ts) behind the platform-neutral
 * interface the agent tools call. No behavior lives here — only wiring.
 */
import type { PlatformAdapter } from "@/lib/platforms/types";
import { getPostComments, searchReddit } from "@/lib/platforms/reddit/client";
import {
  SUBREDDIT_RULE_HINTS,
  SUBREDDIT_WHITELIST,
  type Subreddit,
} from "@/lib/platforms/reddit/communities";

export const redditAdapter: PlatformAdapter = {
  id: "reddit",
  displayName: "Reddit",
  communities: SUBREDDIT_WHITELIST,
  // The orchestrator zod-validates tool inputs against the whitelist enum
  // before executors run, so narrowing string[] back to Subreddit[] is safe.
  searchThreads: (keywords, communities) =>
    searchReddit(keywords, communities as Subreddit[]),
  getComments: (postId) => getPostComments(postId),
  communityNorms: (community) =>
    SUBREDDIT_RULE_HINTS[community as Subreddit] ?? [],
  formatCommunity: (community) => `r/${community}`,
};
