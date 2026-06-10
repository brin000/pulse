"use client";

/**
 * Four-step pipeline indicator: Scan → Select → Gap → Draft.
 * Derives progress from timeline tool events and the streamed result.
 */
import type { RunResult, TimelineEvent } from "@/lib/agent/types";
import type { ToolName } from "@/lib/agent/schemas";
import type { RunStatus } from "@/hooks/useAgentRun";
import { CheckIcon } from "@/components/icons";

const STEPS = [
  { id: "scan", label: "Scan" },
  { id: "select", label: "Select" },
  { id: "gap", label: "Gap" },
  { id: "draft", label: "Draft" },
] as const;

type StepId = (typeof STEPS)[number]["id"];
type StepState = "pending" | "active" | "complete";

/**
 * A tool has at least started. Used for the Scan step: once a downstream tool
 * (quality eval, comments) starts, searching is necessarily over.
 */
function toolStarted(events: TimelineEvent[], tool: ToolName): boolean {
  return events.some(
    (e) => (e.type === "tool_start" || e.type === "tool_result") && e.tool === tool,
  );
}

/** A tool finished successfully. */
function toolCompleted(events: TimelineEvent[], tool: ToolName): boolean {
  return events.some((e) => e.type === "tool_result" && e.tool === tool);
}

/**
 * Map run state onto the four pipeline steps.
 *
 * The `result` SSE event only arrives once the orchestrator finishes, so
 * mid-run progress is derived from the streamed timeline events; `result`
 * fields act as a fallback signal for terminal states.
 */
function deriveStepStates(
  status: RunStatus,
  events: TimelineEvent[],
  result: RunResult | null,
): Record<StepId, StepState> {
  const scanComplete =
    toolStarted(events, "evaluate_result_quality") ||
    toolStarted(events, "get_post_comments") ||
    result?.selectedPost != null;
  // Reading a post's comments is how the orchestrator commits to a thread,
  // so a completed get_post_comments means the Select step is done.
  const selectComplete =
    toolCompleted(events, "get_post_comments") || result?.selectedPost != null;
  const gapComplete =
    toolCompleted(events, "evaluate_content_gap") || result?.gap != null;
  const draftComplete =
    toolCompleted(events, "draft_comment_reply") ||
    (result?.drafts.length ?? 0) > 0;

  if (status === "idle") {
    return { scan: "pending", select: "pending", gap: "pending", draft: "pending" };
  }

  const terminal = status === "finished" || status === "error";

  if (terminal) {
    return {
      scan: scanComplete ? "complete" : "pending",
      select: selectComplete ? "complete" : "pending",
      gap: gapComplete ? "complete" : "pending",
      draft: draftComplete ? "complete" : "pending",
    };
  }

  // While running, the active step is the first incomplete one in pipeline order.
  const active: StepId = !scanComplete
    ? "scan"
    : !selectComplete
      ? "select"
      : !gapComplete
        ? "gap"
        : "draft";

  return {
    scan: scanComplete ? "complete" : active === "scan" ? "active" : "pending",
    select: selectComplete ? "complete" : active === "select" ? "active" : "pending",
    gap: gapComplete ? "complete" : active === "gap" ? "active" : "pending",
    draft: draftComplete ? "complete" : active === "draft" ? "active" : "pending",
  };
}

function stepClasses(state: StepState): string {
  switch (state) {
    case "complete":
      return "border-success/30 bg-success/10 text-success";
    case "active":
      return "border-accent/40 bg-accent/15 text-accent";
    default:
      return "border-line bg-raised text-muted";
  }
}

export function RunStepper({
  status,
  events,
  result,
}: {
  status: RunStatus;
  events: TimelineEvent[];
  result: RunResult | null;
}) {
  const states = deriveStepStates(status, events, result);

  const completedCount = STEPS.filter((s) => states[s.id] === "complete").length;

  return (
    <div className="mb-4">
      <ol
        aria-label="Agent pipeline"
        className="relative flex flex-wrap items-center gap-1.5 sm:gap-2"
      >
        {STEPS.map((step, i) => {
          const state = states[step.id];
          return (
            <li key={step.id} className="flex items-center gap-1.5 sm:gap-2">
              <span
                className={`flex min-h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors ${stepClasses(state)}`}
              >
                {state === "complete" && <CheckIcon size={11} />}
                {state === "active" && (
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current motion-reduce:animate-none" />
                )}
                {step.label}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={`hidden h-px w-3 sm:block sm:w-5 ${
                    states[step.id] === "complete" ? "bg-success/40" : "bg-line"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
      {status !== "idle" && (
        <p className="mt-2 font-mono text-[11px] tabular-nums text-muted">
          {completedCount}/{STEPS.length} stages complete
        </p>
      )}
    </div>
  );
}
