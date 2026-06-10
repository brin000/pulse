/**
 * Minimal hand-rolled Server-Sent Events layer.
 *
 * We intentionally do not hide streaming behind SDK hooks: the wire format is
 * ~20 lines and owning it lets us define custom event types (`timeline`,
 * `result`, `done`) that the cockpit UI consumes. EventSource only supports
 * GET, and Pulse needs a POST body — so the client parses this stream from a
 * `fetch` ReadableStream (see hooks/useAgentRun.ts).
 */

/** Encode one SSE message: `event: <name>\ndata: <json>\n\n`. */
export function sseMessage(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Standard headers that keep proxies and Next.js from buffering the stream. */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
