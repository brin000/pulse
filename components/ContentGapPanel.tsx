"use client";

/**
 * Content gap analysis: which angles the discussion already covers vs what is
 * missing, plus the single recommended angle the drafts will take.
 * Covered/missing are distinguished by icon + heading, not color alone.
 */
import type { ContentGap } from "@/lib/agent/schemas";
import { CheckIcon, LightbulbIcon } from "@/components/icons";

/* The section heading lives in page.tsx, so the panel renders content only. */
export function ContentGapPanel({ gap }: { gap: ContentGap }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          {/* Check = the discussion already has this; quiet on purpose */}
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
            <CheckIcon size={12} className="text-secondary" /> Already covered
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {/* 13px body: secondary keeps AA (muted is reserved for large text) */}
            {gap.coveredAngles.map((angle) => (
              <li key={angle} className="text-[13px] leading-snug text-secondary">
                {angle}
              </li>
            ))}
            {gap.coveredAngles.length === 0 && (
              <li className="text-[13px] text-secondary">Nothing substantial yet.</li>
            )}
          </ul>
        </div>

        <div>
          {/* Lightbulb in accent = these gaps are the opportunity Pulse found */}
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
            <LightbulbIcon size={12} className="text-accent" /> Missing angles
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {gap.missingAngles.map((angle) => (
              <li key={angle} className="text-[13px] leading-snug text-secondary">
                {angle}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The one angle the drafts take — highlighted as the panel's conclusion */}
      <p className="mt-4 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2.5 text-[13px] leading-relaxed text-primary">
        <span className="font-semibold text-accent">Recommended angle: </span>
        {gap.recommendedAngle}
      </p>
    </section>
  );
}
