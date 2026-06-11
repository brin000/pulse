/**
 * The platform id list, alone in its own module on purpose: it is imported
 * by Zod schemas, client components and server adapters alike, so it must
 * stay dependency-free (no fetch/OAuth code can ever ride along with it).
 */
export const PLATFORM_IDS = ["reddit", "hackernews"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
