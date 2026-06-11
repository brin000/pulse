/**
 * Hacker News' PlatformAdapter: wraps the Algolia client (client.ts) and the
 * section knowledge (communities.ts) behind the platform-neutral interface.
 * No behavior lives here — only wiring, same as the Reddit adapter.
 */
import type { PlatformAdapter } from "@/lib/platforms/types";
import { getHnComments, searchHackerNews } from "@/lib/platforms/hackernews/client";
import {
  formatHnCommunity,
  HN_COMMUNITIES,
  HN_NORM_HINTS,
  type HnCommunity,
} from "@/lib/platforms/hackernews/communities";

export const hnAdapter: PlatformAdapter = {
  id: "hackernews",
  displayName: "Hacker News",
  communities: HN_COMMUNITIES,
  // Tool inputs are zod-validated against the per-platform whitelist before
  // executors run, so narrowing string[] back to HnCommunity[] is safe.
  searchThreads: (keywords, communities) =>
    searchHackerNews(keywords, communities as HnCommunity[]),
  getComments: (postId) => getHnComments(postId),
  communityNorms: (community) => HN_NORM_HINTS[community as HnCommunity] ?? [],
  formatCommunity: formatHnCommunity,
};
