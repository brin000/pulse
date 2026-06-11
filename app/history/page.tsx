/**
 * /history — persisted run history, newest first.
 *
 * A Server Component that queries libsql directly (no API route in between:
 * the page IS the read path). Each row links to the replayable detail page.
 * When the database is unavailable, listRuns returns [] and the page degrades
 * to its empty state — history must never look more broken than "no runs yet".
 */
import type { Metadata } from "next";
import Link from "next/link";
import { listRuns } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import {
  CronBadge,
  GoalBadge,
  MockBadge,
  OutcomeBadge,
  summarizeOutput,
} from "@/components/RunBadges";
import { ArrowLeftIcon, PlayIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Run history - Pulse" };

// Always reflect the latest runs; this page must never be statically cached.
export const dynamic = "force-dynamic";

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 px-5 py-10 text-center">
      <p className="text-[14px] font-medium text-primary">No runs yet</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-secondary">
        Every agent run is saved here automatically — results and the full
        execution log. Start one from the cockpit and it will show up.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-4 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PlayIcon size={13} />
        Run the agent
      </Link>
    </div>
  );
}

export default async function HistoryPage() {
  const runs = await listRuns();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <Link
          href="/"
          className="inline-flex min-h-[36px] items-center gap-1.5 text-[12px] text-secondary transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeftIcon size={13} />
          Back to cockpit
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-primary">Run history</h1>
        <p className="mt-0.5 text-[12px] text-secondary">
          Past agent runs with their results and full execution logs.
        </p>
      </header>

      {runs.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className="flex flex-col gap-2">
          {runs.map((run, i) => (
            <li
              key={run.id}
              className="animate-fade-up motion-reduce:animate-none"
              // Static classes can't express per-row stagger; cap it so deep
              // rows don't appear seconds late.
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <Link
                href={`/history/${run.id}`}
                className="block rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-accent/40 hover:bg-surface/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="min-w-0 flex-1 basis-full truncate text-[14px] font-medium text-primary sm:basis-auto">
                    {run.topic}
                  </span>
                  {/* 11px meta uses secondary, never muted (AA at small sizes). */}
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-secondary">
                    {relativeTime(run.createdAt)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <OutcomeBadge outcome={run.outcome} />
                  <GoalBadge goal={run.goal} />
                  {run.source === "cron" && <CronBadge />}
                  {run.mockLlm && <MockBadge />}
                  <span className="font-mono text-[11px] tabular-nums text-secondary">
                    {summarizeOutput(run.result)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
