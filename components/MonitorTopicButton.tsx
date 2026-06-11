"use client";

/**
 * "Monitor this topic" — the quiet subscription entry point shown after a
 * run ends. Deliberately low-key (secondary-nav styling, not a CTA): the
 * deliverable of a run is the drafts, monitoring is an optional follow-up.
 *
 * State machine: checking → idle → saving → subscribed. The mount-time check
 * runs through a Server Action so an already-monitored topic renders its
 * subscribed state instead of offering a duplicate subscription.
 */
import { useEffect, useState } from "react";
import type { RunGoal } from "@/lib/agent/schemas";
import { isTopicSubscribed, subscribeTopic } from "@/app/topics/actions";
import { CheckIcon, RadarIcon } from "@/components/icons";

type MonitorState = "checking" | "idle" | "saving" | "subscribed" | "error";

export function MonitorTopicButton({ topic, goal }: { topic: string; goal: RunGoal }) {
  const [state, setState] = useState<MonitorState>("checking");

  useEffect(() => {
    let cancelled = false;
    setState("checking");
    isTopicSubscribed(topic)
      .then((yes) => !cancelled && setState(yes ? "subscribed" : "idle"))
      // Action unreachable (offline, etc.) — offer the button anyway; the
      // subscribe call has its own error path.
      .catch(() => !cancelled && setState("idle"));
    return () => {
      cancelled = true;
    };
  }, [topic]);

  async function handleClick() {
    setState("saving");
    try {
      const result = await subscribeTopic(topic, goal);
      setState(result === "error" ? "error" : "subscribed");
    } catch {
      setState("error");
    }
  }

  if (state === "checking") {
    // Reserve the slot so the action row doesn't jump when the check lands.
    return <span aria-hidden className="min-h-[36px] min-w-[10rem]" />;
  }

  if (state === "subscribed") {
    return (
      <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 text-[12px] text-success">
        <CheckIcon size={13} />
        Monitoring daily
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={handleClick}
        disabled={state === "saving"}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line bg-surface/50 px-3 text-[12px] text-secondary transition-colors hover:bg-surface hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
      >
        <RadarIcon size={13} />
        {state === "saving" ? "Subscribing…" : "Monitor this topic"}
      </button>
      {state === "error" && (
        <span role="status" className="text-[11px] text-danger">
          Couldn&apos;t save — try again
        </span>
      )}
    </span>
  );
}
