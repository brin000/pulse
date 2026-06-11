/**
 * Platform registry: every PlatformAdapter Pulse can route to.
 *
 * Tools resolve adapters through getPlatform(id) using the platform id the
 * model puts in its tool inputs. The Record type is the enforcement point:
 * adding a PlatformId without registering an adapter fails compilation.
 */
import type { PlatformAdapter, PlatformId } from "@/lib/platforms/types";
import { redditAdapter } from "@/lib/platforms/reddit";
import { hnAdapter } from "@/lib/platforms/hackernews";

export const PLATFORMS: Record<PlatformId, PlatformAdapter> = {
  reddit: redditAdapter,
  hackernews: hnAdapter,
};

export function getPlatform(id: PlatformId): PlatformAdapter {
  return PLATFORMS[id];
}

export type { PlatformAdapter, PlatformId } from "@/lib/platforms/types";
