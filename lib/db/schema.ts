/**
 * Drizzle schema for persistence.
 *
 * `runs` is deliberately denormalized: the full RunResult and the timeline
 * events are stored as JSON blobs because the history UI only ever replays
 * them whole — querying inside a run is a non-goal for the MVP
 * (docs/adr/0003-libsql-persistence.md). The few scalar columns exist so the
 * list view can render without parsing every result blob's heavy parts.
 *
 * Phase 4.2/4.3 add the monitoring tables (docs/adr/0004-scheduled-monitoring.md):
 * `topics` (subscriptions the cron walks), `seen_posts` (per-topic dedup so the
 * cron never recommends the same thread twice) and `notifications` (in-app
 * inbox rows, created only when a run actually produced something).
 */
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  /** crypto.randomUUID, generated app-side so saves need no round trip. */
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  /** "auto" | "reply" | "post" — what the user asked the run to produce. */
  goal: text("goal").notNull(),
  /** "success" | "failed" — the structured RunResult verdict. */
  outcome: text("outcome").notNull(),
  /** Whether the run used mock LLM decisions (SQLite stores booleans as 0/1). */
  mockLlm: integer("mock_llm", { mode: "boolean" }).notNull(),
  /** "live" | "mock" | null — where the Reddit data came from. */
  dataSource: text("data_source"),
  /**
   * "manual" | "cron" — who started the run. Scalar (not buried in the JSON)
   * because the cron budget guardrail counts today's cron runs with a WHERE.
   */
  source: text("source").notNull().default("manual"),
  /** Full RunResult, serialized — replayed verbatim by the detail page. */
  resultJson: text("result_json").notNull(),
  /** TimelineEvent[], serialized — replays the execution log on the detail page. */
  eventsJson: text("events_json").notNull(),
  /** Epoch milliseconds — integer sort beats ISO string parsing for ordering. */
  createdAt: integer("created_at").notNull(),
});

export type RunRow = typeof runs.$inferSelect;

/** A topic subscription: the cron re-runs the agent for every enabled row. */
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  /** "auto" | "reply" | "post" — reused as the goal of every cron run. */
  goal: text("goal").notNull(),
  /** Paused subscriptions stay listed but are skipped by the cron. */
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  /** Epoch ms of the last cron run for this topic; drives oldest-first fairness. */
  lastRunAt: integer("last_run_at"),
});

export type TopicRow = typeof topics.$inferSelect;

/**
 * Posts a topic's cron runs already recommended. Injected into the agent as
 * an exclusion set BEFORE scoring, so "the same thread every morning" is
 * structurally impossible, not just unlikely.
 */
export const seenPosts = sqliteTable(
  "seen_posts",
  {
    topicId: text("topic_id").notNull(),
    postId: text("post_id").notNull(),
    seenAt: integer("seen_at").notNull(),
  },
  // Composite PK doubles as the dedup constraint: re-inserting is a no-op.
  (t) => ({ pk: primaryKey({ columns: [t.topicId, t.postId] }) }),
);

/** One inbox row per notification-worthy cron run (quality gate applied). */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  /** The persisted run this notification points at (/history/[id]). */
  runId: text("run_id").notNull(),
  topicId: text("topic_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  /** Epoch ms when the user marked it read; null = unread. */
  readAt: integer("read_at"),
});

export type NotificationRow = typeof notifications.$inferSelect;
