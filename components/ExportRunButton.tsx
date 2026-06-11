"use client";

/**
 * Copies the finished run as Markdown — the capture step of the dogfooding
 * loop (run → post manually → record the outcome in docs/dogfooding/).
 *
 * Feedback is a quiet label swap on purpose: the pop animation is reserved
 * for the draft copy button (the single delight point of the cockpit).
 */
import { useState } from "react";
import type { RunResult } from "@/lib/agent/types";
import { runToMarkdown } from "@/lib/export";
import { CheckIcon, CopyIcon } from "@/components/icons";

export function ExportRunButton({ result }: { result: RunResult }) {
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    const markdown = runToMarkdown(result);
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // Clipboard API rejects when the document isn't focused; fall back to
      // selection-based copy so the button never silently does nothing.
      const helper = document.createElement("textarea");
      helper.value = markdown;
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
    <button
      onClick={copyMarkdown}
      className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        copied
          ? "border-success/40 bg-success/10 text-success"
          : "border-line bg-surface text-secondary hover:text-primary"
      }`}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {copied ? "Copied as Markdown" : "Export run as Markdown"}
    </button>
  );
}
