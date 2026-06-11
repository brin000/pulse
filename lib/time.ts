/**
 * Compact relative age ("3m ago"). Computed server-side at request time —
 * good enough for list views, where rows age in minutes, not seconds.
 * Shared by /history, /topics and /inbox so the wording never drifts.
 */
export function relativeTime(epochMs: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}
