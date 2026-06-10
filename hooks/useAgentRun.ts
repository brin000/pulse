"use client";

/**
 * Client-side state machine for one agent run.
 *
 * POSTs the topic to /api/agent and incrementally parses the SSE stream from
 * the fetch ReadableStream (EventSource can't POST, so we parse by hand —
 * which also means we understand every byte of our streaming layer).
 *
 * Runs are session-local by design: state lives in this hook and is gone on
 * refresh. The MVP intentionally has no persistence.
 */
import { useCallback, useRef, useState } from "react";
import type { RunResult, TimelineEvent } from "@/lib/agent/types";

export type RunStatus = "idle" | "running" | "finished" | "error";

interface AgentRunState {
  status: RunStatus;
  events: TimelineEvent[];
  result: RunResult | null;
  /** Whether the server is using mock LLM decisions (no API key configured). */
  mockLlm: boolean | null;
  errorMessage: string | null;
}

const INITIAL: AgentRunState = {
  status: "idle",
  events: [],
  result: null,
  mockLlm: null,
  errorMessage: null,
};

/** Parse complete SSE frames out of a text buffer; returns leftover partial data. */
function drainSseBuffer(
  buffer: string,
  onEvent: (event: string, data: unknown) => void,
): string {
  const frames = buffer.split("\n\n");
  // The last chunk may be an incomplete frame — keep it for the next read.
  const leftover = frames.pop() ?? "";
  for (const frame of frames) {
    let eventName = "message";
    let dataLine = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine += line.slice(6);
    }
    if (dataLine) {
      try {
        onEvent(eventName, JSON.parse(dataLine));
      } catch {
        // Malformed frame — skip rather than crash the stream.
      }
    }
  }
  return leftover;
}

export function useAgentRun() {
  const [state, setState] = useState<AgentRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (topic: string) => {
    // Cancel any in-flight run before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL, status: "running" });

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: string, data: unknown) => {
        if (event === "mode") {
          setState((s) => ({ ...s, mockLlm: (data as { mockLlm: boolean }).mockLlm }));
        } else if (event === "timeline") {
          setState((s) => ({ ...s, events: [...s.events, data as TimelineEvent] }));
        } else if (event === "result") {
          setState((s) => ({ ...s, result: data as RunResult }));
        } else if (event === "done") {
          setState((s) => ({
            ...s,
            // A run with zero drafts still "finished" — the UI explains why
            // via the timeline (e.g. search exhausted, agent failed honestly).
            status: "finished",
          }));
        }
      };

      // Read the stream chunk by chunk; frames may span chunk boundaries.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainSseBuffer(buffer, handleEvent);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // superseded by a new run
      setState((s) => ({ ...s, status: "error", errorMessage: String((err as Error).message) }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { ...state, run, reset };
}
