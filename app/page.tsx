"use client";

/**
 * The Pulse agent cockpit.
 *
 * Layout (developer-tool clarity over marketing polish, per CONTEXT.md
 * "Agent Cockpit"): left column = topic input + whitelist; right column =
 * the live execution timeline, then the selected thread, gap analysis and
 * reviewable drafts as the run produces them.
 */
import { useAgentRun } from "@/hooks/useAgentRun";
import { TopicForm } from "@/components/TopicForm";
import { Timeline } from "@/components/Timeline";
import { ThreadCard } from "@/components/ThreadCard";
import { ContentGapPanel } from "@/components/ContentGapPanel";
import { DraftsPanel } from "@/components/DraftsPanel";
import { AlertIcon } from "@/components/icons";

export default function HomePage() {
  const { status, events, result, mockLlm, errorMessage, run } = useAgentRun();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* ---------------- Header ---------------- */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Logo: a pulsing dot — the product name, literally */}
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

        {/* Mode badge: discloses mock vs live LLM decisions */}
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

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ---------------- Left: control panel ---------------- */}
        <div className="flex flex-col gap-4">
          <TopicForm status={status} onRun={run} />

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3.5"
            >
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="text-[13px] font-medium text-danger">Run failed</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-secondary">
                  {errorMessage} — check your connection and try again.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ---------------- Right: timeline + results ---------------- */}
        <div className="flex min-w-0 flex-col gap-4">
          <section>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted">
              Execution timeline
            </h2>
            <Timeline events={events} status={status} />
          </section>

          {/* Results appear progressively as the run completes */}
          {result?.selectedPost && (
            <section>
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted">
                Selected thread
              </h2>
              <ThreadCard post={result.selectedPost} dataSource={result.dataSource} />
            </section>
          )}

          {result?.gap && <ContentGapPanel gap={result.gap} />}

          {result && result.drafts.length > 0 && (
            <DraftsPanel drafts={result.drafts} rules={result.rules} />
          )}

          {/* Honest empty result: the run ended but produced nothing usable */}
          {status === "finished" && result && result.drafts.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-[13px] leading-relaxed text-secondary">
                The agent finished without a draft worth showing — the timeline above
                explains why. Try a broader topic.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Footer ---------------- */}
      <footer className="mt-12 border-t border-line pt-4">
        <p className="font-mono text-[11px] leading-relaxed text-muted">
          on-demand · comment replies only · manual review — Pulse never posts for you ·
          session-local runs, nothing stored
        </p>
      </footer>
    </main>
  );
}
