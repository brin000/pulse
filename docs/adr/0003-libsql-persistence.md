# Persist Run History with libsql and Drizzle

Pulse will persist finished agent runs (the full `RunResult` plus the timeline events) in a libsql database accessed through Drizzle ORM. `DATABASE_URL` defaults to `file:.data/pulse.db`, so local development needs zero configuration; production points the same variable at a Turso database without code changes. The schema is one denormalized `runs` table created lazily with `CREATE TABLE IF NOT EXISTS` on first use — no migration tooling.

## Considered Options

- libsql (`@libsql/client`) + Drizzle: one client that speaks both local SQLite files and Turso's serverless protocol, with a thin typed query layer.
- Postgres (e.g. Neon) + Drizzle: more power than a single history table needs, and no zero-config local story.
- Raw JSON files on disk: zero dependencies, but no ordering/filtering queries and a dead end for any future schema.
- drizzle-kit migrations: the right tool once the schema evolves, but for a single table it adds a build step and a deploy-time migration runner the MVP does not need.

## Consequences

History reads and writes stay invisible to the agent loop: persistence failures only `console.warn`, so the cockpit works identically with the database down. Result and timeline payloads are stored as JSON blobs — the history UI replays them whole, and querying inside a run is a non-goal; the few scalar columns (topic, goal, outcome, mockLlm, dataSource, createdAt) exist for list rendering and ordering.

The `file:` default only fits environments with a persistent writable disk. On serverless platforms (Vercel/Lambda) the filesystem is ephemeral and read-only outside `/tmp`, so a deployed Pulse must set `DATABASE_URL` to Turso for history to survive — with the local file, runs silently vanish on each cold start, which the warn-only error policy tolerates by design.

When the schema grows past trivial additive changes, `CREATE TABLE IF NOT EXISTS` stops being enough and this decision should be revisited in favor of drizzle-kit migrations.
