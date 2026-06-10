"use client";

/**
 * The agent execution timeline — the hero element of the cockpit.
 *
 * Each entry shows WHAT the agent did (mono tool/action name) and WHY
 * (the model's `reason`). Status is conveyed by icon + label + color
 * together, never color alone (accessibility rule `color-not-only`).
 * `aria-live="polite"` lets screen readers follow progress.
 */
import type { TimelineEvent } from "@/lib/agent/types";
import type { RunStatus } from "@/hooks/useAgentRun";
import {
  AlertIcon,
  BrainIcon,
  CheckIcon,
  GaugeIcon,
  LightbulbIcon,
  MessagesIcon,
  PenIcon,
  PlayIcon,
  SearchIcon,
  ShieldIcon,
} from "@/components/icons";

/** Map tool names / event types to a representative icon. */
function eventIcon(event: TimelineEvent) {
  const title = event.title.toLowerCase();
  if (title.includes("search_reddit")) return <SearchIcon size={14} />;
  if (title.includes("evaluate_result_quality")) return <GaugeIcon size={14} />;
  if (title.includes("get_post_comments")) return <MessagesIcon size={14} />;
  if (title.includes("evaluate_content_gap")) return <LightbulbIcon size={14} />;
  if (title.includes("check_subreddit_rules")) return <ShieldIcon size={14} />;
  if (title.includes("draft_comment_reply")) return <PenIcon size={14} />;
  if (event.type === "decision") return <BrainIcon size={14} />;
  if (event.type === "finish") return <CheckIcon size={14} />;
  if (event.type === "error" || event.type === "tool_error") return <AlertIcon size={14} />;
  return <PlayIcon size={12} />;
}

/** Tone classes per event type (paired with icon + label, not color-only). */
function toneClasses(type: TimelineEvent["type"]): string {
  switch (type) {
    case "finish":
      return "text-success border-success/30 bg-success/10";
    case "error":
    case "tool_error":
      return "text-danger border-danger/30 bg-danger/10";
    case "decision":
      return "text-info border-info/30 bg-info/10";
    case "tool_result":
      return "text-success border-line bg-surface";
    default:
      return "text-accent border-line bg-surface";
  }
}

const TYPE_LABEL: Record<TimelineEvent["type"], string> = {
  run_start: "start",
  decision: "decision",
  tool_start: "tool",
  tool_result: "result",
  tool_error: "error",
  finish: "finish",
  error: "error",
};

export function Timeline({
  events,
  status,
}: {
  events: TimelineEvent[];
  status: RunStatus;
}) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-surface/50 px-6 py-16 text-center">
        <BrainIcon size={28} className="text-muted" />
        <p className="text-sm text-secondary">
          Run the agent to watch its decisions stream in live —<br />
          every step shows <span className="text-primary">what</span> it did and{" "}
          <span className="text-primary">why</span>.
        </p>
      </div>
    );
  }

  return (
    <ol aria-live="polite" className="relative flex flex-col gap-1.5">
      {events.map((event) => (
        <li key={event.id} className="animate-fade-up motion-reduce:animate-none">
          <div className="flex items-start gap-3 rounded-lg border border-line/60 bg-surface px-3 py-2.5">
            {/* Status icon chip */}
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${toneClasses(event.type)}`}
            >
              {eventIcon(event)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[13px] font-medium text-primary">
                  {event.title}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  {TYPE_LABEL[event.type]}
                </span>
              </div>
              {/* The model's reason — the "why" that makes this a cockpit, not a spinner */}
              {event.reason && (
                <p className="mt-0.5 text-[13px] leading-relaxed text-secondary">
                  {event.reason}
                </p>
              )}
              {event.detail && (
                <p className="mt-0.5 font-mono text-[12px] text-muted">{event.detail}</p>
              )}
            </div>
          </div>
        </li>
      ))}

      {/* Live indicator while the run is still streaming */}
      {status === "running" && (
        <li className="flex items-center gap-2 px-3 py-2" aria-label="Agent is thinking">
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent motion-reduce:animate-none" />
          <span className="font-mono text-[12px] text-secondary">agent is thinking…</span>
        </li>
      )}
    </ol>
  );
}
