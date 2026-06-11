/**
 * /topics — manage monitored topic subscriptions.
 *
 * A Server Component that queries libsql directly (the page IS the read
 * path) and mutates through Server Actions bound per row — no client state
 * to keep in sync. When the database is unavailable, listTopics returns []
 * and the page degrades to its empty state.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { listTopics } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { removeTopic, toggleTopic } from "@/app/topics/actions";
import { GoalBadge } from "@/components/RunBadges";
import { ArrowLeftIcon, PlayIcon, TrashIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Monitored topics - Pulse" };

// Always reflect the latest subscriptions; never statically cached.
export const dynamic = "force-dynamic";

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 px-5 py-10 text-center">
      <p className="text-[14px] font-medium text-primary">No monitored topics yet</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-secondary">
        Run the agent on a topic, then click &quot;Monitor this topic&quot; under the
        results. Pulse will re-scan it every day and notify you when there is
        something new worth engaging with.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-4 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PlayIcon size={13} />
        Run the agent
      </Link>
    </div>
  );
}

/**
 * Enabled toggle: a form button styled as a switch. Triple-encoded state —
 * knob position (shape), "Daily" / "Paused" label (text) and color — so it
 * never relies on color alone.
 */
function EnabledToggle({ id, enabled }: { id: string; enabled: boolean }) {
  return (
    <form action={toggleTopic.bind(null, id, !enabled)}>
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "Pause daily monitoring" : "Resume daily monitoring"}
        className="flex min-h-[36px] items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-raised/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span
          aria-hidden
          className={`relative h-[18px] w-[32px] rounded-full border transition-colors ${
            enabled ? "border-success/40 bg-success/30" : "border-line bg-raised"
          }`}
        >
          <span
            className={`absolute left-[2px] top-[2px] h-[12px] w-[12px] rounded-full transition-transform motion-reduce:transition-none ${
              enabled ? "translate-x-[14px] bg-success" : "translate-x-0 bg-secondary"
            }`}
          />
        </span>
        <span
          className={`font-mono text-[11px] uppercase tracking-wide ${
            enabled ? "text-success" : "text-secondary"
          }`}
        >
          {enabled ? "Daily" : "Paused"}
        </span>
      </button>
    </form>
  );
}

export default async function TopicsPage() {
  const topics = await listTopics();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <Link
          href="/"
          className="inline-flex min-h-[36px] items-center gap-1.5 text-[12px] text-secondary transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeftIcon size={13} />
          Back to cockpit
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-primary">
          Monitored topics
        </h1>
        <p className="mt-0.5 text-[12px] text-secondary">
          Topics Pulse re-scans on a daily schedule. New findings land in your inbox.
        </p>
      </header>

      {topics.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {topics.map((t, i) => (
            <li
              key={t.id}
              className="animate-fade-up rounded-xl border border-line bg-surface px-4 py-3 motion-reduce:animate-none"
              // Static classes can't express per-row stagger; cap it so deep
              // rows don't appear seconds late.
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <p
                    className={`truncate text-[14px] font-medium ${
                      t.enabled ? "text-primary" : "text-secondary"
                    }`}
                  >
                    {t.topic}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <GoalBadge goal={t.goal} />
                    {/* 11px meta uses secondary, never muted (AA at small sizes). */}
                    <span className="font-mono text-[11px] tabular-nums text-secondary">
                      {t.lastRunAt ? `last run ${relativeTime(t.lastRunAt)}` : "not run yet"}
                    </span>
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <EnabledToggle id={t.id} enabled={t.enabled} />
                  <form action={removeTopic.bind(null, t.id)}>
                    <button
                      type="submit"
                      aria-label={`Stop monitoring "${t.topic}"`}
                      title="Remove subscription"
                      className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-secondary transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
