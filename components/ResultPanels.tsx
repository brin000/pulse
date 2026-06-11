"use client";

/**
 * The result panels of a run: reviewable drafts, selected thread, content gap
 * — and, for post-producing runs, the standalone post.
 *
 * Visibility and ordering follow the run lifecycle:
 * - idle:     hidden — the OutcomePreview owns the stage
 * - running:  skeleton placeholders in pipeline order (thread → gap → drafts)
 * - finished: real content, drafts first (the deliverable the user came for)
 *
 * Post mode (goal=post, or an auto run that pivoted to a standalone post)
 * shows the post panel instead: thread/gap/drafts would only ever be empty
 * placeholders there.
 */
import type { ReactNode } from "react";
import type { RunGoal } from "@/lib/agent/schemas";
import type { RunResult } from "@/lib/agent/types";
import type { RunStatus } from "@/hooks/useAgentRun";
import { ThreadCard } from "@/components/ThreadCard";
import { ContentGapPanel } from "@/components/ContentGapPanel";
import { DraftsPanel } from "@/components/DraftsPanel";
import { StandalonePostPanel } from "@/components/StandalonePostPanel";

/** Per-position stagger so panels fade in top-to-bottom regardless of order. */
const DELAY_CLASSES = [
  "[animation-delay:50ms]",
  "[animation-delay:100ms]",
  "[animation-delay:150ms]",
  "[animation-delay:200ms]",
] as const;

/**
 * Pre-result placeholder: a pulsing skeleton while the agent runs, or a
 * dashed hint box describing what will land here once a run starts.
 */
function PanelPlaceholder({ hint, loading }: { hint: string; loading: boolean }) {
  if (loading) {
    return (
      <div
        aria-hidden
        className="animate-pulse rounded-xl border border-line bg-surface p-4 motion-reduce:animate-none"
      >
        <div className="h-3 w-1/3 rounded bg-raised" />
        <div className="mt-3 h-3 w-5/6 rounded bg-raised" />
        <div className="mt-2 h-3 w-2/3 rounded bg-raised" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 px-4 py-5">
      <p className="text-[12px] leading-relaxed text-secondary">{hint}</p>
    </div>
  );
}

interface Panel {
  key: string;
  title: string;
  content: ReactNode;
}

export function ResultPanels({
  status,
  result,
  goal,
}: {
  status: RunStatus;
  result: RunResult | null;
  goal: RunGoal;
}) {
  if (status === "idle") return null;

  const running = status === "running";
  const finished = status === "finished";
  const terminal = finished || status === "error";
  // Post mode is known up front for goal=post; for auto it is only knowable
  // once the result reveals the run pivoted to a standalone post.
  const postMode = goal === "post" || result?.standalonePost != null;

  const standalonePanel: Panel = {
    key: "standalone",
    title: "Standalone post",
    content: result?.standalonePost ? (
      <StandalonePostPanel post={result.standalonePost} rules={result.rules} />
    ) : terminal && result ? (
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-[13px] leading-relaxed text-secondary">
          {finished
            ? "The agent finished without a post worth showing. Expand the execution log below to see why. Try a broader topic."
            : "The run ended with errors before producing a post. Expand the execution log below to see what happened."}
        </p>
      </div>
    ) : (
      <PanelPlaceholder
        hint="An original post — title and body — drafted for the best-fitting community. You review, you post."
        loading={running}
      />
    ),
  };

  const draftsPanel: Panel = {
    key: "drafts",
    title: "Reviewable drafts",
    content:
      result && result.drafts.length > 0 ? (
        <DraftsPanel drafts={result.drafts} rules={result.rules} />
      ) : terminal && result ? (
        // The run ended without anything publishable — say so honestly and
        // point at the execution log for the "why".
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-[13px] leading-relaxed text-secondary">
            {finished
              ? "The agent finished without a draft worth showing. Expand the execution log below to see why. Try a broader topic."
              : "The run ended with errors before producing a draft. Expand the execution log below to see what happened."}
          </p>
        </div>
      ) : (
        <PanelPlaceholder
          hint="Three tone variants you review, edit and copy. Pulse never posts."
          loading={running}
        />
      ),
  };

  const threadPanel: Panel = {
    key: "thread",
    title: "Selected thread",
    content: result?.selectedPost ? (
      <ThreadCard post={result.selectedPost} dataSource={result.dataSource} />
    ) : (
      <PanelPlaceholder
        hint="The discussion the agent commits to replying in lands here."
        loading={running}
      />
    ),
  };

  const gapPanel: Panel = {
    key: "gap",
    title: "Content gap",
    content: result?.gap ? (
      <ContentGapPanel gap={result.gap} />
    ) : (
      <PanelPlaceholder
        hint="What the thread already covers vs the angle worth adding."
        loading={running}
      />
    ),
  };

  // Finished runs lead with the deliverable; running/error keep pipeline order.
  // Post mode renders only the panels that can actually carry content: the
  // standalone post, plus thread/gap/drafts if a pivoted run produced them.
  const ordered = postMode
    ? [
        standalonePanel,
        ...(result && result.drafts.length > 0 ? [draftsPanel] : []),
        ...(result?.selectedPost ? [threadPanel] : []),
        ...(result?.gap ? [gapPanel] : []),
      ]
    : finished
      ? [draftsPanel, threadPanel, gapPanel]
      : [threadPanel, gapPanel, draftsPanel];

  return (
    <div className="flex animate-fade-up flex-col gap-4 motion-reduce:animate-none">
      {ordered.map((panel, i) => (
        <section
          key={panel.key}
          className={`animate-fade-up motion-reduce:animate-none ${DELAY_CLASSES[i]}`}
        >
          <h2 className="mb-2 text-base font-semibold text-primary">{panel.title}</h2>
          {panel.content}
        </section>
      ))}
    </div>
  );
}
