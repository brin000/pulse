/**
 * Run history persistence — libsql client singleton + the three queries
 * Pulse needs (save / list / get).
 *
 * Design constraints (docs/adr/0003-libsql-persistence.md):
 * - Zero local config: DATABASE_URL defaults to a file: database under .data/,
 *   so `npm run dev` just works. Production points the same env var at Turso.
 * - No migration tooling: the schema is one table, created lazily with
 *   CREATE TABLE IF NOT EXISTS on first use — serverless-friendly and cheap.
 * - Persistence must never break a run: every exported function swallows DB
 *   errors (console.warn) and returns a harmless fallback. The cockpit and
 *   the agent loop work identically with the database down.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { desc, eq } from "drizzle-orm";
import type { RunGoal } from "@/lib/agent/schemas";
import type { RunResult, TimelineEvent } from "@/lib/agent/types";
import { runs, type RunRow } from "@/lib/db/schema";

/** Local default keeps dev zero-config; .data/ is gitignored. */
const DEFAULT_URL = "file:.data/pulse.db";

/** A persisted run with its JSON blobs parsed back into runtime shapes. */
export interface StoredRun {
  id: string;
  topic: string;
  goal: RunGoal;
  outcome: "success" | "failed";
  mockLlm: boolean;
  dataSource: "live" | "mock" | null;
  result: RunResult;
  events: TimelineEvent[];
  /** Epoch milliseconds. */
  createdAt: number;
}

/** What the API route hands over after a run ends. */
export interface SaveRunInput {
  topic: string;
  goal: RunGoal;
  outcome: "success" | "failed";
  mockLlm: boolean;
  result: RunResult;
  events: TimelineEvent[];
}

/**
 * Lazy singleton, stashed on globalThis so Next.js dev hot-reloads reuse the
 * same connection instead of leaking one libsql client per recompile.
 * `ready` is the one-shot CREATE TABLE IF NOT EXISTS promise: every query
 * awaits it, so the schema exists before first use without a migration step.
 */
interface DbHandle {
  db: LibSQLDatabase;
  ready: Promise<void>;
}

const globalForDb = globalThis as unknown as { __pulseDb?: DbHandle };

function getDb(): DbHandle {
  if (globalForDb.__pulseDb) return globalForDb.__pulseDb;

  const url = process.env.DATABASE_URL || DEFAULT_URL;
  // libsql does not create parent directories for file: databases.
  if (url.startsWith("file:")) {
    mkdirSync(path.dirname(url.slice("file:".length)) || ".", { recursive: true });
  }

  const client = createClient({
    url,
    // Only relevant for remote (Turso) URLs; ignored for file: databases.
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });

  const ready = client
    .execute(
      `CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        goal TEXT NOT NULL,
        outcome TEXT NOT NULL,
        mock_llm INTEGER NOT NULL,
        data_source TEXT,
        result_json TEXT NOT NULL,
        events_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )
    .then(() => undefined);

  globalForDb.__pulseDb = { db: drizzle(client), ready };
  return globalForDb.__pulseDb;
}

function parseRow(row: RunRow): StoredRun {
  return {
    id: row.id,
    topic: row.topic,
    goal: row.goal as RunGoal,
    outcome: row.outcome as "success" | "failed",
    mockLlm: row.mockLlm,
    dataSource: row.dataSource as "live" | "mock" | null,
    result: JSON.parse(row.resultJson) as RunResult,
    events: JSON.parse(row.eventsJson) as TimelineEvent[],
    createdAt: row.createdAt,
  };
}

/**
 * Persist one finished run (including cancelled ones — their outcome is
 * already "failed"). Failures only warn: history is an optional feature,
 * the run the user just watched must never look broken because of it.
 */
export async function saveRun(input: SaveRunInput): Promise<void> {
  try {
    const { db, ready } = getDb();
    await ready;
    await db.insert(runs).values({
      id: randomUUID(),
      topic: input.topic,
      goal: input.goal,
      outcome: input.outcome,
      mockLlm: input.mockLlm,
      dataSource: input.result.dataSource,
      resultJson: JSON.stringify(input.result),
      eventsJson: JSON.stringify(input.events),
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn("[db] failed to persist run:", err);
  }
}

/**
 * Most recent runs first, capped — the history list is a recency view, not
 * an archive browser. Returns [] when the DB is unavailable so the page
 * degrades to its empty state instead of crashing.
 */
export async function listRuns(limit = 50): Promise<StoredRun[]> {
  try {
    const { db, ready } = getDb();
    await ready;
    const rows = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit);
    return rows.map(parseRow);
  } catch (err) {
    console.warn("[db] failed to list runs:", err);
    return [];
  }
}

/** One run by id, or null when missing/unavailable (page renders 404). */
export async function getRun(id: string): Promise<StoredRun | null> {
  try {
    const { db, ready } = getDb();
    await ready;
    const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
    return rows[0] ? parseRow(rows[0]) : null;
  } catch (err) {
    console.warn("[db] failed to load run:", err);
    return null;
  }
}
