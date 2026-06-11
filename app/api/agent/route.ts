/**
 * POST /api/agent — runs one agent loop and streams progress as SSE.
 *
 * All model calls happen here on the server; the Anthropic API key never
 * reaches the browser. The response is a hand-rolled SSE stream with three
 * event types the cockpit understands:
 *
 *   event: timeline  — one TimelineEvent per orchestrator step
 *   event: result    — the final RunResult (selected thread, gap, drafts)
 *   event: done      — stream end marker, carries { outcome: "success" | "failed" }
 */
import { z } from "zod";
import { runAgent } from "@/lib/agent/orchestrator";
import { runGoalSchema } from "@/lib/agent/schemas";
import { isLiveLlmAuthorized, isMockLlm } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { SSE_HEADERS, sseMessage } from "@/lib/sse";

// Streaming requires the Node.js runtime; static optimization must be off.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One run = several sequential LLM calls; the platform default would cut
// live runs off mid-stream.
export const maxDuration = 300;

/** Validate user input at the system boundary. */
const requestSchema = z.object({
  topic: z.string().trim().min(3, "Topic must be at least 3 characters").max(200),
  /** Run goal; defaults to auto so older clients without it keep working. */
  goal: runGoalSchema.default("auto"),
  /** Optional unlock token for live LLM mode on gated deployments. */
  liveToken: z.string().max(200).optional(),
});

/** Best-effort client key for rate limiting (first hop of x-forwarded-for). */
function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

export async function POST(req: Request) {
  const limit = checkRateLimit(clientKey(req));
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many runs from this address. Please wait a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec ?? 60) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { topic, goal, liveToken } = parsed.data;
  // Per-request mode: env says whether live is possible at all, the token
  // gate says whether THIS visitor may spend real LLM credits.
  const mockLlm = isMockLlm() || !isLiveLlmAuthorized(liveToken);

  // Aborts the agent loop when the client goes away, via either path:
  // the request itself being aborted, or the response stream being cancelled.
  // Without this the orchestrator would keep burning model tokens for no one.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(sseMessage(event, data));
        } catch {
          // Client disconnected mid-run; the loop result is simply dropped.
        }
      };

      // Tell the UI up front whether this run uses mock or live LLM decisions.
      send("mode", { mockLlm });

      // Pessimistic default: only a run that returns normally flips it.
      let outcome: "success" | "failed" = "failed";
      try {
        const result = await runAgent(topic, (event) => send("timeline", event), abort.signal, mockLlm, goal);
        outcome = result.outcome;
        send("result", result);
      } catch (err) {
        send("timeline", {
          id: `evt-fatal-${Date.now()}`,
          type: "error",
          title: "Unexpected error",
          detail: String(err),
          timestamp: new Date().toISOString(),
        });
      } finally {
        send("done", { outcome });
        try {
          controller.close();
        } catch {
          // Stream already cancelled by the client — closing again would throw.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
