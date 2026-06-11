"use client";

/**
 * The thread the agent committed to replying in (Reddit or Hacker News).
 * Meta values (score / comments / age) use tabular mono so numbers align
 * and don't shift layout as they render.
 */
import type { PostSummary } from "@/lib/agent/schemas";
// format.ts is dependency-free, safe in client bundles (no fetch/OAuth code).
import { formatCommunity, PLATFORM_BADGES } from "@/lib/platforms/format";
import { ArrowUpIcon, ExternalLinkIcon, MessagesIcon } from "@/components/icons";

export function ThreadCard({
  post,
  dataSource,
}: {
  post: PostSummary;
  dataSource: "live" | "mock" | null;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Platform badge: same visual language as the mock-data badge */}
          <span className="rounded-full border border-line bg-raised px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-secondary">
            {PLATFORM_BADGES[post.platform]}
          </span>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[12px] text-accent">
            {formatCommunity(post.platform, post.community)}
          </span>
        </div>
        {/* Honesty rule: mock data is always disclosed, never passed off as real */}
        {dataSource === "mock" && (
          <span className="rounded-full border border-line bg-raised px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-secondary">
            mock data
          </span>
        )}
      </div>

      <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-primary">
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm decoration-accent/50 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {post.title}
          <ExternalLinkIcon size={12} className="ml-1.5 inline-block text-muted" />
        </a>
      </h3>

      {post.snippet && (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-secondary">
          {post.snippet}
        </p>
      )}

      {/* tabular-nums: digits keep a fixed width, so meta never shifts as it renders */}
      <dl className="mt-3 flex gap-4 font-mono text-[12px] tabular-nums text-secondary">
        <div className="flex items-center gap-1">
          <ArrowUpIcon size={12} className="text-muted" />
          <dt className="sr-only">Score</dt>
          <dd>{post.score}</dd>
        </div>
        <div className="flex items-center gap-1">
          <MessagesIcon size={12} className="text-muted" />
          <dt className="sr-only">Comments</dt>
          <dd>{post.numComments}</dd>
        </div>
        <div>
          <dt className="sr-only">Age</dt>
          <dd>{Math.round(post.ageHours)}h old</dd>
        </div>
      </dl>
    </article>
  );
}
