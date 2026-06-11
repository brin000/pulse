"use client";

/**
 * Finished/error runs: timeline as on-demand observability, not the page hero.
 * Running runs use the always-expanded ExecutionSection instead.
 */
import { useState } from "react";
import type { TimelineEvent } from "@/lib/agent/types";
import type { RunResult } from "@/lib/agent/types";
import type { RunStatus } from "@/hooks/useAgentRun";
import { Timeline } from "@/components/Timeline";
import { RunStepper } from "@/components/RunStepper";
import { ChevronDownIcon } from "@/components/icons";

export function TimelineCollapsible({
  status,
  events,
  result,
  defaultOpen = false,
}: {
  status: RunStatus;
  events: TimelineEvent[];
  result: RunResult | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const decisionCount = events.filter(
    (e) => e.type === "decision" || e.type === "finish" || e.type === "run_start",
  ).length;

  // `status` reflects the server's structured outcome (done event), so it is
  // the single source of truth for success vs failure here.
  // A standalone post counts as a deliverable just like reply drafts.
  const summaryLabel =
    status === "error"
      ? "Run ended with errors"
      : result && (result.drafts.length > 0 || result.standalonePost)
        ? "Run finished"
        : "Run finished without a draft";

  return (
    <section className="rounded-xl border border-line bg-surface/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-surface/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <span className="text-[13px] font-medium text-primary">{summaryLabel}</span>
        {/* 11px meta uses secondary: muted fails AA at this size */}
        <span className="font-mono text-[11px] tabular-nums text-secondary">
          {decisionCount} decision{decisionCount === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[12px] text-secondary">
          {open ? "Hide log" : "Show execution log"}
          <ChevronDownIcon
            size={14}
            className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <RunStepper status={status} events={events} result={result} />
          <Timeline events={events} status={status} />
        </div>
      )}
    </section>
  );
}
