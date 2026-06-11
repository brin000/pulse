"use client";

/**
 * The agent execution timeline — observability rail during a run.
 *
 * Each entry shows WHAT the agent did (mono tool/action name) and WHY
 * (the model's `reason`). Status is conveyed by icon + label + color
 * together, never color alone (accessibility rule `color-not-only`).
 * `aria-live="polite"` lets screen readers follow progress.
 */
import type { ReactNode } from "react";
import type { TimelineEvent } from "@/lib/agent/types";
import { canonicalToolName, type ToolName } from "@/lib/agent/schemas";
import type { RunStatus } from "@/hooks/useAgentRun";
import {
  AlertIcon,
  BrainIcon,
  CheckIcon,
  FileTextIcon,
  GaugeIcon,
  LightbulbIcon,
  MessagesIcon,
  PenIcon,
  PlayIcon,
  SearchIcon,
  ShieldIcon,
} from "@/components/icons";

/** One representative icon per tool, keyed by the event's structured `tool` field. */
const TOOL_ICONS: Record<ToolName, ReactNode> = {
  search_threads: <SearchIcon size={14} />,
  evaluate_result_quality: <GaugeIcon size={14} />,
  get_thread_comments: <MessagesIcon size={14} />,
  evaluate_content_gap: <LightbulbIcon size={14} />,
  check_community_norms: <ShieldIcon size={14} />,
  draft_comment_reply: <PenIcon size={14} />,
  draft_standalone_post: <FileTextIcon size={14} />,
};

function eventIcon(event: TimelineEvent) {
  // Stored events may carry pre-rename tool names (search_reddit, ...);
  // canonicalToolName maps them so history replay keeps its icons. Anything
  // unknown falls through to the per-type icons instead of rendering nothing.
  const tool = canonicalToolName(event.tool);
  if (tool) return TOOL_ICONS[tool];
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
    if (status === "running") {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-6">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent motion-reduce:animate-none" />
          <p className="text-[13px] text-secondary">Agent starting…</p>
        </div>
      );
    }
    return null;
  }

  // Decisions carry the "why"; tool_start duplicates the same reason. Results
  // stay as compact one-liners so the rail reads decision → outcome.
  const visibleEvents = events.filter((e) => e.type !== "tool_start");

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <ol aria-live="polite" className="relative flex flex-col">
        {visibleEvents.map((event, i) => {
          const isMajor = event.type !== "tool_result";
          const isLast = i === visibleEvents.length - 1 && status !== "running";

          return (
            <li
              key={event.id}
              className={`relative animate-fade-up motion-reduce:animate-none ${
                isMajor ? "pl-9" : "pl-7"
              }`}
            >
              {!isLast && (
                <span
                  aria-hidden
                  className={`absolute bottom-0 w-px bg-line/70 ${
                    isMajor ? "left-[11px] top-7" : "left-[7px] top-5"
                  }`}
                />
              )}
              <span
                className={`absolute left-0 top-0 flex items-center justify-center rounded-md border ${toneClasses(event.type)} ${
                  isMajor ? "h-6 w-6" : "h-4 w-4"
                }`}
              >
                {isMajor ? eventIcon(event) : <CheckIcon size={10} />}
              </span>

              <div className={`min-w-0 ${isLast ? "" : isMajor ? "pb-3.5" : "pb-2"}`}>
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
                {event.reason && isMajor && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-secondary">
                    {event.reason}
                  </p>
                )}
                {event.detail && (
                  <p
                    className={`mt-0.5 font-mono tabular-nums text-secondary ${
                      isMajor ? "text-[12px]" : "text-[11px]"
                    }`}
                  >
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
