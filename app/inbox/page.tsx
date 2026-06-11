/**
 * /inbox — notifications from scheduled monitoring runs, unread first.
 *
 * A Server Component over libsql. The main click target of each row is a
 * Server Action that marks the notification read AND redirects to the run
 * detail, so reading and clearing can never drift apart; unread rows also
 * get an explicit "Mark read" button for clearing without navigating.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { countUnreadNotifications, listNotifications } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { markRead, openNotification } from "@/app/inbox/actions";
import { ArrowLeftIcon, CheckIcon, RadarIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Inbox - Pulse" };

// Always reflect the latest notifications; never statically cached.
export const dynamic = "force-dynamic";

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 px-5 py-10 text-center">
      <p className="text-[14px] font-medium text-primary">Nothing here yet</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-secondary">
        When a scheduled run finds something worth engaging with — new drafts
        or a post suggestion — the notification lands here. Subscribe to a
        topic to get started.
      </p>
      <Link
        href="/topics"
        className="mt-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-4 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <RadarIcon size={13} />
        Monitored topics
      </Link>
    </div>
  );
}

export default async function InboxPage() {
  const [items, unread] = await Promise.all([
    listNotifications(),
    countUnreadNotifications(),
  ]);

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
        <h1 className="mt-1 text-xl font-bold tracking-tight text-primary">Inbox</h1>
        <p className="mt-0.5 text-[12px] tabular-nums text-secondary">
          {unread > 0
            ? `${unread} unread notification${unread === 1 ? "" : "s"} from scheduled monitoring.`
            : "Notifications from scheduled monitoring runs."}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((n, i) => {
            const isUnread = n.readAt === null;
            return (
              <li
                key={n.id}
                className={`animate-fade-up rounded-xl border bg-surface transition-colors motion-reduce:animate-none ${
                  isUnread ? "border-accent/40" : "border-line"
                }`}
                // Static classes can't express per-row stagger; cap it so deep
                // rows don't appear seconds late.
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              >
                <div className="flex items-start gap-1 px-2 py-1">
                  {/* Main target: mark read + open the run this points at. */}
                  <form action={openNotification.bind(null, n.id, n.runId)} className="min-w-0 flex-1">
                    <button
                      type="submit"
                      className="block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-raised/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {/* Unread is triple-encoded: dot (shape), NEW label (text), accent border (color). */}
                        {isUnread && (
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                            <span className="font-mono text-[10px] uppercase tracking-wide text-accent">
                              new
                            </span>
                          </span>
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate text-[14px] ${
                            isUnread ? "font-semibold text-primary" : "font-medium text-secondary"
                          }`}
                        >
                          {n.title}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-secondary">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                      <span className="mt-1 block text-[12px] leading-relaxed text-secondary">
                        {n.body}
                      </span>
                      <span className="mt-1 block text-[11px] text-secondary">
                        Open run details →
                      </span>
                    </button>
                  </form>
                  {isUnread && (
                    <form action={markRead.bind(null, n.id)} className="shrink-0 pt-1">
                      <button
                        type="submit"
                        aria-label="Mark as read"
                        title="Mark as read"
                        className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-secondary transition-colors hover:bg-raised hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <CheckIcon size={14} />
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
