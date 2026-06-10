"use client";

/**
 * Topic input — the single primary CTA of the cockpit.
 * Visible label + persistent helper text (never placeholder-only labels),
 * disabled+spinner while running, button height ≥ 44px.
 */
import { useState, type FormEvent } from "react";
import { SUBREDDIT_WHITELIST } from "@/lib/config";
import type { RunStatus } from "@/hooks/useAgentRun";
import { PlayIcon } from "@/components/icons";

const EXAMPLE_TOPIC = "building practical AI agents with Vercel AI SDK";

export function TopicForm({
  status,
  onRun,
}: {
  status: RunStatus;
  onRun: (topic: string) => void;
}) {
  const [topic, setTopic] = useState(EXAMPLE_TOPIC);
  const running = status === "running";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (trimmed.length >= 3 && !running) onRun(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-4">
      <label htmlFor="topic" className="block text-[13px] font-medium text-primary">
        What do you want to talk about?
      </label>
      <p className="mt-1 text-[12px] leading-relaxed text-secondary">
        Pulse scans the curated subreddits for live discussions worth joining and
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

      <button
        type="submit"
        disabled={running || topic.trim().length < 3}
        className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-accent-strong font-semibold text-bg transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {running ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bg/30 border-t-bg motion-reduce:animate-none" />
            <span className="text-[14px]">Agent running…</span>
          </>
        ) : (
          <>
            <PlayIcon size={14} />
            <span className="text-[14px]">Run agent</span>
          </>
        )}
      </button>

      {/* The curated whitelist, disclosed as part of the product (ADR-0002) */}
      <div className="mt-4 border-t border-line pt-3">
        {/* 11px label: secondary for AA contrast (muted measured 4.19:1 here) */}
        <h3 className="font-mono text-[11px] uppercase tracking-wide text-secondary">
          Curated subreddits
        </h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {SUBREDDIT_WHITELIST.map((sub) => (
            <li
              key={sub}
              className="rounded-full border border-line bg-raised px-2.5 py-0.5 font-mono text-[11px] text-secondary"
            >
              r/{sub}
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
