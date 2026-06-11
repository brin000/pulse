/**
 * Platform registry: every PlatformAdapter Pulse can route to.
 *
 * Tools resolve adapters through getPlatform(id) instead of importing
 * platform clients directly — P5-2 adds Hacker News by registering a second
 * entry here (plus carrying a platform id through tool inputs).
 */
import type { PlatformAdapter, PlatformId } from "@/lib/platforms/types";
import { redditAdapter } from "@/lib/platforms/reddit";

export const PLATFORMS: Record<PlatformId, PlatformAdapter> = {
  reddit: redditAdapter,
};

export function getPlatform(id: PlatformId): PlatformAdapter {
  return PLATFORMS[id];
}

export type { PlatformAdapter, PlatformId } from "@/lib/platforms/types";
