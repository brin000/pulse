/**
 * Serialize a finished run as Markdown for the dogfooding archive
 * (docs/dogfooding/ case files: run summary → posted version → outcome).
 */
import type { RunResult } from "@/lib/agent/types";
import { formatCommunity } from "@/lib/platforms/format";

const TONE_LABEL: Record<string, string> = {
  practical: "Practical",
  "experience-based": "Experience-based",
  curious: "Curious",
};

export function runToMarkdown(result: RunResult): string {
  const lines: string[] = [
    `# Pulse run: ${result.topic}`,
    "",
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Outcome: ${result.outcome}`,
    `- Steps: ${result.steps}`,
    `- Data source: ${result.dataSource ?? "n/a"}`,
  ];

  if (result.selectedPost) {
    const p = result.selectedPost;
    lines.push(
      "",
      "## Selected thread",
      "",
      `**[${p.title}](${p.url})** — ${formatCommunity(p.platform, p.community)}`,
      "",
      `${p.score} points · ${p.numComments} comments · ${Math.round(p.ageHours)}h old`,
    );
  }

  if (result.gap) {
    lines.push("", "## Content gap", "");
    if (result.gap.coveredAngles.length > 0) {
      lines.push("Already covered:", ...result.gap.coveredAngles.map((a) => `- ${a}`), "");
    }
    lines.push("Missing angles:", ...result.gap.missingAngles.map((a) => `- ${a}`), "");
    lines.push(`**Recommended angle:** ${result.gap.recommendedAngle}`);
  }

  if (result.drafts.length > 0) {
    lines.push("", "## Drafts");
    for (const draft of result.drafts) {
      lines.push(
        "",
        `### ${TONE_LABEL[draft.tone] ?? draft.tone} (spam risk: ${draft.selfCheck.spamRisk})`,
        "",
        draft.text,
      );
    }
  }

  if (result.standalonePost) {
    const post = result.standalonePost;
    const target = post.community
      ? ` for ${formatCommunity(post.platform, post.community)}`
      : "";
    lines.push(
      "",
      `## Standalone post${target}`,
      "",
      `### ${post.title}`,
      "",
      `_${TONE_LABEL[post.tone] ?? post.tone} · spam risk: ${post.selfCheck.spamRisk}_`,
      "",
      post.body,
    );
  }

  lines.push(
    "",
    "## Outcome (fill in after posting)",
    "",
    "- Posted version: ",
    "- Posted at: ",
    "- 24h: upvotes / replies: ",
    "- 48h: upvotes / replies: ",
    "- Notes: ",
    "",
  );

  return lines.join("\n");
}
