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
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunGoal } from "@/lib/agent/schemas";
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

  // Abort the in-flight run on unmount so the fetch loop stops reading and
  // setState is never called on an unmounted component.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (topic: string, goal: RunGoal = "auto") => {
    // Cancel any in-flight run before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // True only while this `run` invocation is the latest one. Without this
    // guard, events already queued from a superseded run would leak into the
    // new run's state (mixed topics on the timeline).
    const isCurrent = () => abortRef.current === controller;

    setState({ ...INITIAL, status: "running" });

    try {
      // Unlock token for live LLM mode on gated deployments: visiting the
      // page as /?live=<token> forwards it with every run request.
      const liveToken =
        new URLSearchParams(window.location.search).get("live") ?? undefined;

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, goal, liveToken }),
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
        if (!isCurrent()) return; // superseded by a newer run — drop the event
        if (event === "mode") {
          setState((s) => ({ ...s, mockLlm: (data as { mockLlm: boolean }).mockLlm }));
        } else if (event === "timeline") {
          setState((s) => ({ ...s, events: [...s.events, data as TimelineEvent] }));
        } else if (event === "result") {
          setState((s) => ({ ...s, result: data as RunResult }));
        } else if (event === "done") {
          // The server states the verdict explicitly — no need to infer it
          // from the event log. A finish with zero drafts is still "finished";
          // the UI explains the empty result separately.
          const failed = (data as { outcome?: string }).outcome === "failed";
          setState((s) => ({ ...s, status: failed ? "error" : "finished" }));
        }
      };

      // Read the stream chunk by chunk; frames may span chunk boundaries.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainSseBuffer(buffer, handleEvent);
      }

      // The stream can end without a `done` event (server crash, proxy cut).
      // Never leave the UI stuck on "running" in that case.
      if (isCurrent()) {
        setState((s) =>
          s.status === "running"
            ? { ...s, status: "error", errorMessage: "The stream ended unexpectedly" }
            : s,
        );
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // superseded by a new run
      if (!isCurrent()) return; // a newer run owns the state now
      setState((s) => ({ ...s, status: "error", errorMessage: String((err as Error).message) }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { ...state, run, reset };
}
