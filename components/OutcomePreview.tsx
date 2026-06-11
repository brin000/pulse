"use client";

/**
 * Idle-state preview: what the user gets after a run (README success path),
 * instead of an empty execution timeline stage.
 */
import { RunStepper } from "@/components/RunStepper";
import { PenIcon, LightbulbIcon, MessagesIcon } from "@/components/icons";

const OUTCOMES = [
  {
    icon: MessagesIcon,
    title: "Selected thread",
    body: "A live Reddit or Hacker News discussion still worth joining, with score and activity context.",
  },
  {
    icon: LightbulbIcon,
    title: "Content gap",
    body: "What the thread already covers vs the missing angle worth adding.",
  },
  {
    icon: PenIcon,
    title: "Reviewable drafts",
    body: "Three tone variants you review, edit, and copy. Pulse never posts for you.",
  },
] as const;

export function OutcomePreview() {
  return (
    <section className="rounded-xl border border-line bg-surface/60 p-4 shadow-[inset_0_1px_0_rgb(var(--text-primary)/0.04)]">
      <h2 className="mb-1 text-base font-semibold text-primary">What you&apos;ll get</h2>
      <p className="mb-4 text-[13px] text-secondary">
        Enter a topic and run the agent. Pulse picks the platform that fits,
        scans its curated communities, reads the room, and drafts replies for
        manual review.
      </p>

      <RunStepper status="idle" events={[]} result={null} />

      <ul className="mt-2 flex flex-col gap-2.5">
        {OUTCOMES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex gap-3 rounded-lg border border-line/80 bg-surface px-3 py-2.5"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-muted">
              <Icon size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-primary">{title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-secondary">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
