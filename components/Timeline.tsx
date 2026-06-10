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

/**
 * HH:MM:SS wall-clock for each event. Fixed 24h locale so SSR and client
 * render identically; tabular-nums in the markup keeps the column stable
 * while events stream in.
 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

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
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <ol aria-live="polite" className="relative flex flex-col">
        {events.map((event, i) => {
          const prev = events[i - 1];
          // The orchestrator emits decision → tool_start with the same reason;
          // showing it twice in a row is pure noise, so the tool row drops it.
          const duplicateReason =
            event.type === "tool_start" &&
            prev?.type === "decision" &&
            prev.reason === event.reason;
          // Decisions (and run boundaries) are what the user reads; tool
          // start/result rows are mechanical follow-ups, rendered quieter.
          const isMajor = !(event.type === "tool_start" || event.type === "tool_result");
          const isLast = i === events.length - 1 && status !== "running";

          return (
            <li
              key={event.id}
              className="relative animate-fade-up pl-9 motion-reduce:animate-none"
            >
              {/* Rail connecting this event to the next one */}
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-[11px] top-7 w-px bg-line/70"
                />
              )}
              {/* Status icon chip (icon + label + color, never color alone) */}
              <span
                className={`absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-md border ${toneClasses(event.type)}`}
              >
                {eventIcon(event)}
              </span>

              <div className={`min-w-0 ${isLast ? "" : "pb-3.5"}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={`font-mono font-medium ${
                      isMajor ? "text-[13px] text-primary" : "text-[12px] text-secondary"
                    }`}
                  >
                    {event.title}
                  </span>
                  {/* 11-12px meta must use secondary: muted fails AA at this size */}
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                    {TYPE_LABEL[event.type]}
                  </span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-secondary">
                    {formatTime(event.timestamp)}
                  </span>
                </div>
                {/* The model's reason — the "why" that makes this a cockpit, not a spinner */}
                {event.reason && !duplicateReason && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-secondary">
                    {event.reason}
                  </p>
                )}
                {event.detail && (
                  <p className="mt-0.5 font-mono text-[12px] tabular-nums text-secondary">
                    {event.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}

        {/* Live indicator while the run is still streaming */}
        {status === "running" && (
          <li className="relative pl-9" aria-label="Agent is thinking">
            <span
              aria-hidden
              className="absolute left-[11px] top-[-14px] h-3.5 w-px bg-line/70"
            />
            <span className="absolute left-2 top-1 flex h-2 w-2">
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent motion-reduce:animate-none" />
            </span>
            <span className="font-mono text-[12px] text-secondary">agent is thinking…</span>
          </li>
        )}
      </ol>
    </div>
  );
}
