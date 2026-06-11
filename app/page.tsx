"use client";

/**
 * The Pulse agent cockpit.
 *
 * State-based hierarchy (README success path):
 * - idle:     outcome preview (what you'll get)
 * - running:  execution timeline expanded, result skeletons below
 * - finished: drafts → thread → gap first; execution log collapsed at bottom
 *
 * This page owns run state (via useAgentRun) and the overall layout; each
 * lifecycle view lives in its own component under components/.
 */
import { useRef } from "react";
import { useAgentRun } from "@/hooks/useAgentRun";
import { TopicForm } from "@/components/TopicForm";
import { OutcomePreview } from "@/components/OutcomePreview";
import { ExecutionSection } from "@/components/ExecutionSection";
import { TimelineCollapsible } from "@/components/TimelineCollapsible";
import { ResultPanels } from "@/components/ResultPanels";
import { ExportRunButton } from "@/components/ExportRunButton";
import { AlertIcon, ShieldIcon, PlayIcon, CheckIcon, GaugeIcon } from "@/components/icons";

/** Product promises, restated at the bottom of every page state. */
const TRUST_BADGES = [
  { icon: PlayIcon, label: "On-demand runs" },
  { icon: CheckIcon, label: "Manual review only" },
  { icon: ShieldIcon, label: "Never posts for you" },
  { icon: GaugeIcon, label: "Session-local, nothing stored" },
] as const;

function PageHeader({ mockLlm }: { mockLlm: boolean | null }) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
          <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-accent motion-reduce:animate-none" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary">Pulse</h1>
          <p className="text-[12px] text-secondary">
            The right Reddit conversations, at the right time, with something worth saying.
          </p>
        </div>
      </div>

      {/* mockLlm is null until the server's `mode` SSE event arrives. */}
      {mockLlm !== null && (
        <span
          className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide ${
            mockLlm
              ? "border-info/30 bg-info/10 text-info"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {mockLlm ? "mock mode" : "live · claude"}
        </span>
      )}
    </header>
  );
}

/** Stream-level failure notice (network/server). Tool-level errors stay on the timeline. */
function RunErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: (() => void) | null;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3.5"
    >
      <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-danger">Run failed</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-secondary">
          {message}. Check your connection and try again.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 rounded-lg border border-danger/40 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry run
          </button>
        )}
      </div>
    </div>
  );
}

function PageFooter() {
  return (
    <footer className="mt-12 border-t border-line pt-5">
      <ul className="flex flex-wrap gap-2">
        {TRUST_BADGES.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface/50 px-3 py-1.5 text-[11px] text-secondary"
          >
            <Icon size={12} className="shrink-0 text-muted" />
            {label}
          </li>
        ))}
      </ul>
    </footer>
  );
}

export default function HomePage() {
  const { status, events, result, mockLlm, errorMessage, run } = useAgentRun();
  // Remembered so a failed run can be retried with one click.
  const lastTopicRef = useRef("");

  function handleRun(topic: string) {
    lastTopicRef.current = topic;
    run(topic);
  }

  const idle = status === "idle";
  const running = status === "running";
  const terminal = status === "finished" || status === "error";

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader mockLlm={mockLlm} />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr] lg:gap-6">
        {/* Left rail: topic input + run-level errors, sticky on desktop. */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <TopicForm status={status} onRun={handleRun} />
          {errorMessage && (
            <RunErrorNotice
              message={errorMessage}
              onRetry={lastTopicRef.current ? () => run(lastTopicRef.current) : null}
            />
          )}
        </div>

        {/* Main column: one view per lifecycle phase. */}
        <div className="flex min-w-0 flex-col gap-4">
          {idle && <OutcomePreview />}
          {running && <ExecutionSection status={status} events={events} result={result} />}
          <ResultPanels status={status} result={result} />
          {terminal && result && (
            <div className="flex justify-end">
              <ExportRunButton result={result} />
            </div>
          )}
          {terminal && events.length > 0 && (
            <TimelineCollapsible status={status} events={events} result={result} />
          )}
        </div>
      </div>

      <PageFooter />
    </main>
  );
}
