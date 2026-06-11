/**
 * /history/[id] — replay of one persisted run.
 *
 * A Server Component that loads the stored RunResult + TimelineEvent[] from
 * libsql and feeds them into the same client components the live cockpit
 * uses (ResultPanels, TimelineCollapsible). Stored runs map onto a terminal
 * run status — "finished" or "error" — so the components render exactly as
 * they did the moment the run ended.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/db";
import { ResultPanels } from "@/components/ResultPanels";
import { TimelineCollapsible } from "@/components/TimelineCollapsible";
import { GoalBadge, MockBadge, OutcomeBadge, summarizeOutput } from "@/components/RunBadges";
import { ArrowLeftIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Run detail - Pulse" };

// Reads the database per request; never statically cached.
export const dynamic = "force-dynamic";

/** Fixed 24h en-GB format: unambiguous, and stable regardless of server locale. */
function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const run = await getRun(params.id);
  if (!run) notFound();

  // Stored outcome → the terminal client status the result components expect.
  const status = run.outcome === "success" ? "finished" : "error";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <Link
          href="/history"
          className="inline-flex min-h-[36px] items-center gap-1.5 text-[12px] text-secondary transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeftIcon size={13} />
          Back to history
        </Link>
        <h1 className="mt-1 break-words text-xl font-bold tracking-tight text-primary">
          {run.topic}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <OutcomeBadge outcome={run.outcome} />
          <GoalBadge goal={run.goal} />
          {run.mockLlm && <MockBadge />}
          <span className="font-mono text-[11px] tabular-nums text-secondary">
            {summarizeOutput(run.result)}
          </span>
          <span aria-hidden className="text-[11px] text-secondary">
            ·
          </span>
          <span className="font-mono text-[11px] tabular-nums text-secondary">
            {formatDateTime(run.createdAt)}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <ResultPanels status={status} result={run.result} goal={run.goal} />
        {run.events.length > 0 && (
          <TimelineCollapsible
            status={status}
            events={run.events}
            result={run.result}
            defaultOpen
          />
        )}
      </div>
    </main>
  );
}
