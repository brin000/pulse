/**
 * Small presentational badges shared by the history list and detail pages.
 *
 * No "use client" on purpose: these render fine on the server, so the
 * history pages stay pure Server Components all the way down to the
 * (client) result/timeline components they embed.
 *
 * Accessibility rule `color-not-only`: outcome is always icon + label +
 * color together, never color alone.
 */
import type { RunResult } from "@/lib/agent/types";
import type { PlatformId } from "@/lib/platforms/ids";
import { PLATFORM_BADGES } from "@/lib/platforms/format";
import { CheckIcon, XIcon } from "@/components/icons";

/** Goal pill — same mono/uppercase language as the cockpit's mode badge. */
export function GoalBadge({ goal }: { goal: string }) {
  return (
    <span className="rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-secondary">
      {goal}
    </span>
  );
}

/** Which platform a run's deliverable targets (REDDIT / HN). */
export function PlatformBadge({ platform }: { platform: PlatformId }) {
  return (
    <span className="rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-secondary">
      {PLATFORM_BADGES[platform]}
    </span>
  );
}

/**
 * The platform a stored run delivered for, read off the result. Null when
 * the run produced nothing platform-bound (failed before selecting/drafting).
 */
export function runPlatform(result: RunResult): PlatformId | null {
  return result.selectedPost?.platform ?? result.standalonePost?.platform ?? null;
}

/** Marks runs started by the scheduled monitor, not a person at the cockpit. */
export function CronBadge() {
  return (
    <span className="rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-secondary">
      cron
    </span>
  );
}

/** Mock-LLM marker so demo runs are never passed off as live ones. */
export function MockBadge() {
  return (
    <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-info">
      mock
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: "success" | "failed" }) {
  const success = outcome === "success";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        success
          ? "border-success/30 bg-success/10 text-success"
          : "border-danger/30 bg-danger/10 text-danger"
      }`}
    >
      {success ? <CheckIcon size={11} /> : <XIcon size={11} />}
      {success ? "success" : "failed"}
    </span>
  );
}

/** One-line deliverable summary for a stored run (list rows + detail meta). */
export function summarizeOutput(result: RunResult): string {
  const parts: string[] = [];
  if (result.drafts.length > 0) {
    parts.push(`${result.drafts.length} draft${result.drafts.length === 1 ? "" : "s"}`);
  }
  if (result.standalonePost) parts.push("standalone post");
  return parts.length > 0 ? parts.join(" + ") : "no output";
}
