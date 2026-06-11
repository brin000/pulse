"use client";

/**
 * Topic input — the single primary CTA of the cockpit.
 * Visible label + persistent helper text (never placeholder-only labels),
 * disabled+spinner while running, button height ≥ 44px.
 */
import { useState, type FormEvent } from "react";
// Both communities modules and format.ts are dependency-free by design —
// importing them here never drags server-only fetch/OAuth code into the bundle.
import {
  formatRedditCommunity,
  SUBREDDIT_WHITELIST,
} from "@/lib/platforms/reddit/communities";
import {
  formatHnCommunity,
  HN_COMMUNITIES,
} from "@/lib/platforms/hackernews/communities";
import type { RunGoal } from "@/lib/agent/schemas";
import type { RunStatus } from "@/hooks/useAgentRun";
import { PlayIcon } from "@/components/icons";

const EXAMPLE_TOPIC = "building practical AI agents with Vercel AI SDK";

/** Goal options with the one-line consequence each choice has on the run. */
const GOAL_OPTIONS: Array<{ value: RunGoal; label: string; hint: string }> = [
  {
    value: "auto",
    label: "Auto",
    hint: "Tries to join a live thread; pivots to an original post if none fits.",
  },
  {
    value: "reply",
    label: "Reply only",
    hint: "Drafts replies for an existing discussion, or reports why none worked.",
  },
  {
    value: "post",
    label: "Post only",
    hint: "Skips thread hunting and drafts an original post for the best community.",
  },
];

/** The curated whitelist per platform, disclosed as part of the product (ADR-0002/0005). */
const PLATFORM_COMMUNITY_GROUPS = [
  {
    label: "Reddit",
    communities: SUBREDDIT_WHITELIST.map(formatRedditCommunity),
  },
  {
    label: "Hacker News",
    communities: HN_COMMUNITIES.map(formatHnCommunity),
  },
] as const;

export function TopicForm({
  status,
  onRun,
}: {
  status: RunStatus;
  onRun: (topic: string, goal: RunGoal) => void;
}) {
  const [topic, setTopic] = useState(EXAMPLE_TOPIC);
  const [goal, setGoal] = useState<RunGoal>("auto");
  const running = status === "running";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (trimmed.length >= 3 && !running) onRun(trimmed, goal);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-4">
      <label htmlFor="topic" className="block text-[13px] font-medium text-primary">
        What do you want to talk about?
      </label>
      <p className="mt-1 text-[12px] leading-relaxed text-secondary">
        Pulse picks the platform that fits your topic — Reddit or Hacker News —
        scans its curated communities for live discussions worth joining, and
        drafts replies you can review.
      </p>

      <textarea
        id="topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter inserts a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        rows={3}
        maxLength={200}
        disabled={running}
        className="mt-3 w-full resize-none rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-[14px] leading-relaxed text-primary placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60"
        placeholder={EXAMPLE_TOPIC}
      />

      {/* Run goal — segmented radio pills, styled like the draft tone tabs. */}
      <fieldset className="mt-3" disabled={running}>
        <legend className="text-[12px] font-medium text-secondary">Goal</legend>
        <div role="radiogroup" aria-label="Run goal" className="mt-1.5 flex gap-1.5">
          {GOAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={goal === option.value}
              onClick={() => setGoal(option.value)}
              className={`min-h-[36px] flex-1 rounded-lg border px-2 font-mono text-[12px] transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                goal === option.value
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-line bg-raised text-secondary hover:text-primary"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {/* Persistent hint so the consequence of the choice is never hidden. */}
        <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">
          {GOAL_OPTIONS.find((o) => o.value === goal)?.hint}
        </p>
      </fieldset>

      <button
        type="submit"
        disabled={running || topic.trim().length < 3}
        className="group mt-3 flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-full bg-accent-strong pl-2 pr-5 font-semibold text-bg transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {running ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bg/30 border-t-bg motion-reduce:animate-none" />
            <span className="text-[14px]">Agent running…</span>
          </>
        ) : (
          <>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-bg/20 transition-colors group-hover:bg-bg/30">
              <PlayIcon size={14} />
            </span>
            <span className="text-[14px]">Run agent</span>
          </>
        )}
      </button>

      {/* The curated whitelists, disclosed as part of the product (ADR-0002/0005) */}
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
        {PLATFORM_COMMUNITY_GROUPS.map((group) => (
          <div key={group.label}>
            <h3 className="text-[12px] font-medium text-secondary">
              Curated {group.label} communities
            </h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {group.communities.map((community) => (
                <li
                  key={community}
                  className="rounded-full border border-line bg-raised px-2.5 py-0.5 font-mono text-[11px] text-secondary"
                >
                  {community}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </form>
  );
}
