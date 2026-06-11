"use client";

/**
 * Standalone post result: title + body + self-check chips + copy button.
 *
 * Same review-first boundary as reply drafts: Pulse never posts. The copy
 * feedback is a quiet label swap on purpose — the pop animation stays
 * reserved for the draft copy button (the cockpit's single delight point).
 */
import { useState } from "react";
import type { CommunityNorms, StandalonePost } from "@/lib/agent/schemas";
// format.ts is dependency-free, safe in client bundles (no fetch/OAuth code).
import { formatCommunity, PLATFORM_BADGES } from "@/lib/platforms/format";
import { SelfCheckChips } from "@/components/DraftsPanel";
import { CheckIcon, CopyIcon, ShieldIcon } from "@/components/icons";

const TONE_LABEL: Record<StandalonePost["tone"], string> = {
  practical: "Practical",
  "experience-based": "Experience-based",
  curious: "Curious",
};

export function StandalonePostPanel({
  post,
  rules,
}: {
  post: StandalonePost;
  rules: CommunityNorms | null;
}) {
  const [copied, setCopied] = useState(false);
  // Pre-P5-3 posts carry no target fields; the norms object is the fallback.
  const targetPlatform = post.community ? post.platform : rules?.platform;
  const targetCommunity = post.community || rules?.community;

  async function copyPost() {
    // Title + body together — that's what gets pasted into the platform's composer.
    const text = `${post.title}\n\n${post.body}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API rejects when the document isn't focused; fall back to
      // selection-based copy so the button never silently does nothing.
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    /* The section heading lives in ResultPanels, so the panel renders content only. */
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Platform badge: same visual language as the ThreadCard badge */}
          {targetPlatform && (
            <span className="rounded-full border border-line bg-raised px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-secondary">
              {PLATFORM_BADGES[targetPlatform]}
            </span>
          )}
          {targetPlatform && targetCommunity && (
            <span className="rounded-full border border-line bg-raised px-2.5 py-0.5 font-mono text-[11px] text-secondary">
              {formatCommunity(targetPlatform, targetCommunity)}
            </span>
          )}
          <span className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] text-accent">
            {TONE_LABEL[post.tone]}
          </span>
        </div>
        {/* The product boundary, stated where the action happens */}
        <span className="font-mono text-[11px] text-secondary">
          you review · you decide · you post
        </span>
      </div>

      {/* Post preview: title styled as Reddit would weight it, then the body */}
      <div className="mt-3 rounded-lg border border-line bg-bg/60 p-3.5">
        <h3 className="text-[15px] font-semibold leading-snug text-primary">
          {post.title}
        </h3>
        <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-relaxed text-primary">
          {post.body}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SelfCheckChips selfCheck={post.selfCheck} />
        <button
          onClick={copyPost}
          className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-4 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            copied
              ? "border-success/40 bg-success/15 text-success"
              : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
          }`}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          <span className="text-[13px]">{copied ? "Copied" : "Copy post"}</span>
        </button>
      </div>

      {/* Community norms the post was written against */}
      {rules && (
        <div className="mt-4 border-t border-line pt-3">
          {/* Small meta text uses secondary so it stays AA-readable on surface */}
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
            <ShieldIcon size={12} />
            {formatCommunity(rules.platform, rules.community)} norms applied
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
