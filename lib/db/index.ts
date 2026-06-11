/**
 * Persistence layer — libsql client singleton + every query Pulse needs
 * (runs, topic subscriptions, seen-post dedup, notifications).
 *
 * Design constraints (docs/adr/0003-libsql-persistence.md, 0004):
 * - Zero local config: DATABASE_URL defaults to a file: database under .data/,
 *   so `npm run dev` just works. Production points the same env var at Turso.
 * - No migration tooling: tables are created lazily with CREATE TABLE IF NOT
 *   EXISTS on first use — serverless-friendly and cheap. The one additive
 *   change to an existing table (runs.source) is handled with a try/catch
 *   ALTER TABLE so databases created before Phase 4.2 keep working.
 * - Persistence must never break a run: every exported function swallows DB
 *   errors (console.warn) and returns a harmless fallback. The cockpit and
 *   the agent loop work identically with the database down.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { RunGoal } from "@/lib/agent/schemas";
import type { RunResult, TimelineEvent } from "@/lib/agent/types";
import {
  notifications,
  runs,
  seenPosts,
  topics,
  type NotificationRow,
  type RunRow,
  type TopicRow,
} from "@/lib/db/schema";

/** Local default keeps dev zero-config; .data/ is gitignored. */
const DEFAULT_URL = "file:.data/pulse.db";

/** Who started a run — manual cockpit runs vs scheduled cron runs. */
export type RunSource = "manual" | "cron";

/** A persisted run with its JSON blobs parsed back into runtime shapes. */
export interface StoredRun {
  id: string;
  topic: string;
  goal: RunGoal;
  outcome: "success" | "failed";
  mockLlm: boolean;
  dataSource: "live" | "mock" | null;
  source: RunSource;
  result: RunResult;
  events: TimelineEvent[];
  /** Epoch milliseconds. */
  createdAt: number;
}

/** What a caller hands over after a run ends. */
export interface SaveRunInput {
  topic: string;
  goal: RunGoal;
  outcome: "success" | "failed";
  mockLlm: boolean;
  result: RunResult;
  events: TimelineEvent[];
  /** Defaults to "manual" so the existing cockpit path needs no change. */
  source?: RunSource;
}

/**
 * Lazy singleton, stashed on globalThis so Next.js dev hot-reloads reuse the
 * same connection instead of leaking one libsql client per recompile.
 * `ready` is the one-shot bootstrap promise: every query awaits it, so the
 * schema exists before first use without a migration step.
 */
interface DbHandle {
  db: LibSQLDatabase;
  ready: Promise<void>;
}

const globalForDb = globalThis as unknown as { __pulseDb?: DbHandle };

/**
 * One-time schema bootstrap. CREATE TABLE IF NOT EXISTS covers fresh
 * databases; the ALTER TABLE covers databases created before runs.source
 * existed (IF NOT EXISTS does nothing for an already-existing table, so the
 * new column must be added explicitly). "duplicate column" on an up-to-date
 * database is the expected, harmless outcome of that ALTER.
 */
async function bootstrap(client: Client): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      goal TEXT NOT NULL,
      outcome TEXT NOT NULL,
      mock_llm INTEGER NOT NULL,
      data_source TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      result_json TEXT NOT NULL,
      events_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  );
  try {
    await client.execute(
      `ALTER TABLE runs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    );
  } catch {
    // Column already exists — either a fresh CREATE above or a previous boot.
  }
  await client.execute(
    `CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      goal TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_run_at INTEGER
    )`,
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS seen_posts (
      topic_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (topic_id, post_id)
    )`,
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    )`,
  );
}

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

  globalForDb.__pulseDb = { db: drizzle(client), ready: bootstrap(client) };
  return globalForDb.__pulseDb;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                 */
/* ------------------------------------------------------------------ */

function parseRow(row: RunRow): StoredRun {
  return {
    id: row.id,
    topic: row.topic,
    goal: row.goal as RunGoal,
    outcome: row.outcome as "success" | "failed",
    mockLlm: row.mockLlm,
    dataSource: row.dataSource as "live" | "mock" | null,
    source: (row.source as RunSource) ?? "manual",
    result: JSON.parse(row.resultJson) as RunResult,
    events: JSON.parse(row.eventsJson) as TimelineEvent[],
    createdAt: row.createdAt,
  };
}

/**
 * Persist one finished run (including cancelled ones — their outcome is
 * already "failed"). Failures only warn: history is an optional feature,
 * the run the user just watched must never look broken because of it.
 * Returns the new run id (null on failure) so the cron can link a
 * notification to the stored run.
 */
export async function saveRun(input: SaveRunInput): Promise<string | null> {
  try {
    const { db, ready } = getDb();
    await ready;
    const id = randomUUID();
    await db.insert(runs).values({
      id,
      topic: input.topic,
      goal: input.goal,
      outcome: input.outcome,
      mockLlm: input.mockLlm,
      dataSource: input.result.dataSource,
      source: input.source ?? "manual",
      resultJson: JSON.stringify(input.result),
      eventsJson: JSON.stringify(input.events),
      createdAt: Date.now(),
    });
    return id;
  } catch (err) {
    console.warn("[db] failed to persist run:", err);
    return null;
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

/**
 * How many cron runs were persisted since `sinceEpochMs` — the daily budget
 * guardrail. Returns Infinity when the DB is down: if we cannot verify the
 * budget we must not spend it (fail closed — the opposite of the read paths,
 * because this guard exists to cap cost, not to keep a page rendering).
 */
export async function countCronRunsSince(sinceEpochMs: number): Promise<number> {
  try {
    const { db, ready } = getDb();
    await ready;
    const rows = await db
      .select({ n: count() })
      .from(runs)
      .where(and(eq(runs.source, "cron"), gte(runs.createdAt, sinceEpochMs)));
    return rows[0]?.n ?? 0;
  } catch (err) {
    console.warn("[db] failed to count cron runs:", err);
    return Number.POSITIVE_INFINITY;
  }
}

/* ------------------------------------------------------------------ */
/* Topic subscriptions                                                  */
/* ------------------------------------------------------------------ */

export type StoredTopic = TopicRow;

/** All subscriptions, newest first — the /topics management list. */
export async function listTopics(): Promise<StoredTopic[]> {
  try {
    const { db, ready } = getDb();
    await ready;
    return await db.select().from(topics).orderBy(desc(topics.createdAt));
  } catch (err) {
    console.warn("[db] failed to list topics:", err);
    return [];
  }
}

/**
 * Enabled subscriptions, least-recently-run first (never-run rows lead:
 * SQLite sorts NULL first on ASC). The cron takes the head of this list, so
 * topics that missed a capped invocation are first in line next time.
 */
export async function listEnabledTopicsOldestFirst(limit: number): Promise<StoredTopic[]> {
  try {
    const { db, ready } = getDb();
    await ready;
    return await db
      .select()
      .from(topics)
      .where(eq(topics.enabled, true))
      .orderBy(asc(topics.lastRunAt))
      .limit(limit);
  } catch (err) {
    console.warn("[db] failed to list enabled topics:", err);
    return [];
  }
}

/** Case-insensitive lookup so "Agent loops" and "agent loops" are one subscription. */
export async function findTopicByName(topic: string): Promise<StoredTopic | null> {
  try {
    const { db, ready } = getDb();
    await ready;
    const rows = await db
      .select()
      .from(topics)
      .where(sql`lower(${topics.topic}) = ${topic.trim().toLowerCase()}`)
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[db] failed to find topic:", err);
    return null;
  }
}

/** Create a subscription; returns the new row or null when persistence failed. */
export async function createTopic(topic: string, goal: RunGoal): Promise<StoredTopic | null> {
  try {
    const { db, ready } = getDb();
    await ready;
    const row: TopicRow = {
      id: randomUUID(),
      topic: topic.trim(),
      goal,
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
    };
    await db.insert(topics).values(row);
    return row;
  } catch (err) {
    console.warn("[db] failed to create topic:", err);
    return null;
  }
}

export async function setTopicEnabled(id: string, enabled: boolean): Promise<void> {
  try {
    const { db, ready } = getDb();
    await ready;
    await db.update(topics).set({ enabled }).where(eq(topics.id, id));
  } catch (err) {
    console.warn("[db] failed to toggle topic:", err);
  }
}

/** Delete a subscription and its dedup memory (notifications keep their run link). */
export async function deleteTopic(id: string): Promise<void> {
  try {
    const { db, ready } = getDb();
    await ready;
    await db.delete(seenPosts).where(eq(seenPosts.topicId, id));
    await db.delete(topics).where(eq(topics.id, id));
  } catch (err) {
    console.warn("[db] failed to delete topic:", err);
  }
}

export async function touchTopicLastRun(id: string): Promise<void> {
  try {
    const { db, ready } = getDb();
    await ready;
    await db.update(topics).set({ lastRunAt: Date.now() }).where(eq(topics.id, id));
  } catch (err) {
    console.warn("[db] failed to update topic last run:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Seen posts (cron dedup memory)                                       */
/* ------------------------------------------------------------------ */

/** Post ids this topic's cron runs already recommended — the exclusion set. */
export async function getSeenPostIds(topicId: string): Promise<string[]> {
  try {
    const { db, ready } = getDb();
    await ready;
    const rows = await db
      .select({ postId: seenPosts.postId })
      .from(seenPosts)
      .where(eq(seenPosts.topicId, topicId));
    return rows.map((r) => r.postId);
  } catch (err) {
    console.warn("[db] failed to load seen posts:", err);
    return [];
  }
}

/** Remember a recommended post. Conflict = already seen, which is fine. */
export async function addSeenPost(topicId: string, postId: string): Promise<void> {
  try {
    const { db, ready } = getDb();
    await ready;
    await db
      .insert(seenPosts)
      .values({ topicId, postId, seenAt: Date.now() })
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[db] failed to record seen post:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

export type StoredNotification = NotificationRow;

export interface CreateNotificationInput {
  runId: string;
  topicId: string;
  title: string;
  body: string;
}

/** Returns the new id, or null when persistence failed (cron carries on). */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<string | null> {
  try {
    const { db, ready } = getDb();
    await ready;
    const id = randomUUID();
    await db.insert(notifications).values({
      id,
      runId: input.runId,
      topicId: input.topicId,
      title: input.title,
      body: input.body,
      createdAt: Date.now(),
      readAt: null,
    });
    return id;
  } catch (err) {
    console.warn("[db] failed to create notification:", err);
    return null;
  }
}

/** Unread first, then newest first — the inbox ordering. */
export async function listNotifications(limit = 50): Promise<StoredNotification[]> {
  try {
    const { db, ready } = getDb();
    await ready;
    return await db
      .select()
      .from(notifications)
      .orderBy(desc(sql`${notifications.readAt} IS NULL`), desc(notifications.createdAt))
      .limit(limit);
  } catch (err) {
    console.warn("[db] failed to list notifications:", err);
    return [];
  }
}

/** Unread count for the nav badge; 0 when the DB is down (badge just hides). */
export async function countUnreadNotifications(): Promise<number> {
  try {
    const { db, ready } = getDb();
    await ready;
    const rows = await db
      .select({ n: count() })
      .from(notifications)
      .where(isNull(notifications.readAt));
    return rows[0]?.n ?? 0;
  } catch (err) {
    console.warn("[db] failed to count unread notifications:", err);
    return 0;
  }
}

/** Idempotent: only stamps read_at the first time. */
export async function markNotificationRead(id: string): Promise<void> {
  try {
    const { db, ready } = getDb();
    await ready;
    await db
      .update(notifications)
      .set({ readAt: Date.now() })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
  } catch (err) {
    console.warn("[db] failed to mark notification read:", err);
  }
}
