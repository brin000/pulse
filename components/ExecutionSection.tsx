"use client";

/**
 * Running-state execution view: stepper + live timeline (observability home).
 */
import type { TimelineEvent } from "@/lib/agent/types";
import type { RunResult } from "@/lib/agent/types";
import type { RunStatus } from "@/hooks/useAgentRun";
import { Timeline } from "@/components/Timeline";
import { RunStepper } from "@/components/RunStepper";

export function ExecutionSection({
  status,
  events,
  result,
}: {
  status: RunStatus;
  events: TimelineEvent[];
  result: RunResult | null;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface/60 p-4 shadow-[inset_0_1px_0_rgb(var(--text-primary)/0.04)]">
      <h2 className="mb-2 text-base font-semibold text-primary">Execution timeline</h2>
      <RunStepper status={status} events={events} result={result} />
      <Timeline events={events} status={status} />
    </section>
  );
}
