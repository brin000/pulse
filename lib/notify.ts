/**
 * Email notification via the Resend REST API.
 *
 * Plain fetch on purpose — pulling in the Resend SDK for one POST endpoint
 * would be a heavy dependency for zero extra capability. Email is strictly
 * best-effort: misconfiguration or API failure logs one line and returns,
 * never disturbing the cron run that triggered it (in-app notifications are
 * the reliable channel; email is a convenience mirror).
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Resend's shared onboarding sender — works without domain verification. */
const DEFAULT_FROM = "Pulse <onboarding@resend.dev>";
const SEND_TIMEOUT_MS = 8000;

export interface RunEmailInput {
  topic: string;
  /** Persisted run id — the email points the reader at /history/<id>. */
  runId: string;
  /** "Recommended thread: ..." or "Suggested post: ..." */
  headline: string;
  /** Public Reddit URL of the recommended thread, when there is one. */
  threadUrl?: string | null;
}

/**
 * Send a short "new findings" email. Returns true only when Resend accepted
 * the message. Skips silently (one console.log) when RESEND_API_KEY or
 * NOTIFY_EMAIL is not configured — email is opt-in by configuration.
 */
export async function sendRunEmail(input: RunEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) {
    console.log("[notify] email skipped: RESEND_API_KEY / NOTIFY_EMAIL not configured");
    return false;
  }

  const lines = [
    `Pulse found something new for "${input.topic}".`,
    ``,
    input.headline,
    ...(input.threadUrl ? [input.threadUrl] : []),
    ``,
    // Relative on purpose: the deployment URL isn't known here, and the
    // in-app inbox links the run directly anyway.
    `Review the drafts in your Pulse run history: /history/${input.runId}`,
  ];

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || DEFAULT_FROM,
        to: [to],
        subject: `Pulse: new findings for "${input.topic.slice(0, 80)}"`,
        text: lines.join("\n"),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[notify] Resend responded ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[notify] email send failed:", err);
    return false;
  }
}
