/**
 * POST /api/agent — runs one agent loop and streams progress as SSE.
 *
 * All model calls happen here on the server; the Anthropic API key never
 * reaches the browser. The response is a hand-rolled SSE stream with three
 * event types the cockpit understands:
 *
 *   event: timeline  — one TimelineEvent per orchestrator step
 *   event: result    — the final RunResult (selected thread, gap, drafts)
 *   event: done      — stream end marker
 */
import { z } from "zod";
import { runAgent } from "@/lib/agent/orchestrator";
import { isMockLlm } from "@/lib/config";
import { SSE_HEADERS, sseMessage } from "@/lib/sse";

// Streaming requires the Node.js runtime; static optimization must be off.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Validate user input at the system boundary. */
const requestSchema = z.object({
  topic: z.string().trim().min(3, "Topic must be at least 3 characters").max(200),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { topic } = parsed.data;

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
      send("mode", { mockLlm: isMockLlm() });

      try {
        const result = await runAgent(topic, (event) => send("timeline", event));
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
        send("done", {});
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
