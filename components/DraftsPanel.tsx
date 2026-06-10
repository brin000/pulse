"use client";

/**
 * Reviewable drafts: tone tabs + draft body + self-check chips + copy button.
 *
 * Pulse never posts automatically — the copy button IS the product boundary:
 * the human reviews, edits and decides what to publish.
 */
import { useState } from "react";
import type { Draft, SubredditRules } from "@/lib/agent/schemas";
import { CheckIcon, CopyIcon, ShieldIcon } from "@/components/icons";

const TONE_LABEL: Record<Draft["tone"], string> = {
  practical: "Practical",
  "experience-based": "Experience",
  curious: "Curious",
};

function SelfCheckChips({ draft }: { draft: Draft }) {
  const chips = [
    { label: "tone match", pass: draft.selfCheck.toneMatch },
    { label: "useful", pass: draft.selfCheck.useful },
    {
      label: `spam risk: ${draft.selfCheck.spamRisk}`,
      pass: draft.selfCheck.spamRisk === "low",
    },
  ];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Draft self-check">
      {chips.map((chip) => (
        <li
          key={chip.label}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
            chip.pass
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          <CheckIcon size={10} />
          {chip.label}
        </li>
      ))}
    </ul>
  );
}

export function DraftsPanel({
  drafts,
  rules,
}: {
  drafts: Draft[];
  rules: SubredditRules | null;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const active = drafts[Math.min(activeIndex, drafts.length - 1)];

  async function copyActiveDraft() {
    try {
      await navigator.clipboard.writeText(active.text);
    } catch {
      // Clipboard API rejects when the document isn't focused (or in older
      // browsers); fall back to selection-based copy so the button never
      // silently does nothing.
      const helper = document.createElement("textarea");
      helper.value = active.text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    // Brief success feedback, auto-resets (forms & feedback rule).
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    /* The section heading lives in page.tsx, so the panel renders content only. */
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Tone tabs */}
        <div role="tablist" aria-label="Draft tones" className="flex gap-1.5">
          {drafts.map((draft, i) => (
            <button
              key={draft.tone}
              role="tab"
              aria-selected={i === activeIndex}
              onClick={() => setActiveIndex(i)}
              className={`min-h-[36px] rounded-lg border px-3 font-mono text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                i === activeIndex
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-line bg-raised text-secondary hover:text-primary"
              }`}
            >
              {TONE_LABEL[draft.tone]}
            </button>
          ))}
        </div>
        {/* The product boundary, stated where the action happens */}
        <span className="font-mono text-[11px] text-secondary">
          you review · you decide · you post
        </span>
      </div>

      {/* Active draft body */}
      <div className="mt-3 rounded-lg border border-line bg-bg/60 p-3.5">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-primary">
          {active.text}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SelfCheckChips draft={active} />
        <button
          onClick={copyActiveDraft}
          className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-4 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            copied
              ? "border-success/40 bg-success/15 text-success"
              : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
          }`}
        >
          {copied ? (
            /* The cockpit's single delight moment: the check pops in on success */
            <CheckIcon size={14} className="animate-pop motion-reduce:animate-none" />
          ) : (
            <CopyIcon size={14} />
          )}
          <span className="text-[13px]">{copied ? "Copied" : "Copy draft"}</span>
        </button>
      </div>

      {/* Community norms the drafts were written against */}
      {rules && (
        <div className="mt-4 border-t border-line pt-3">
          {/* Small meta text uses secondary so it stays AA-readable on surface */}
          <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-secondary">
            <ShieldIcon size={12} />
            r/{rules.subreddit} norms applied
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {rules.hints.map((hint) => (
              <li key={hint} className="text-[12px] leading-snug text-secondary">
                · {hint}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
