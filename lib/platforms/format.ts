/**
 * Pure display helpers for platforms and communities.
 *
 * Client components must not import the PlatformAdapter registry (it pulls in
 * OAuth/fetch code), so the formatting logic lives here as a dependency-free
 * module composed from the per-platform communities files. Server code may
 * use either this module or adapter.formatCommunity — they are the same
 * functions.
 */
import type { PlatformId } from "@/lib/platforms/ids";
import { formatRedditCommunity } from "@/lib/platforms/reddit/communities";
import { formatHnCommunity } from "@/lib/platforms/hackernews/communities";

/** Human-readable platform names. */
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  reddit: "Reddit",
  hackernews: "Hacker News",
};

/** Short uppercase badge text (ThreadCard / history rows). */
export const PLATFORM_BADGES: Record<PlatformId, string> = {
  reddit: "REDDIT",
  hackernews: "HN",
};

const FORMATTERS: Record<PlatformId, (community: string) => string> = {
  reddit: formatRedditCommunity,
  hackernews: formatHnCommunity,
};

/** Display form of a community, e.g. ("reddit","webdev") -> "r/webdev". */
export function formatCommunity(platform: PlatformId, community: string): string {
  return FORMATTERS[platform](community);
}
