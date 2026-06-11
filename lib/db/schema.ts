/**
 * Drizzle schema for run history persistence.
 *
 * One table, deliberately denormalized: the full RunResult and the timeline
 * events are stored as JSON blobs because the history UI only ever replays
 * them whole — querying inside a run is a non-goal for the MVP
 * (docs/adr/0003-libsql-persistence.md). The few scalar columns exist so the
 * list view can render without parsing every result blob's heavy parts.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  /** Full RunResult, serialized — replayed verbatim by the detail page. */
  resultJson: text("result_json").notNull(),
  /** TimelineEvent[], serialized — replays the execution log on the detail page. */
  eventsJson: text("events_json").notNull(),
  /** Epoch milliseconds — integer sort beats ISO string parsing for ordering. */
  createdAt: integer("created_at").notNull(),
});

export type RunRow = typeof runs.$inferSelect;
