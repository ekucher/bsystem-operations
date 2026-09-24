import type { Db } from './db.js';

// Versioned migrations keyed off SQLite's built-in `PRAGMA user_version`
// (a single integer stored in the DB file header — no extra bookkeeping
// table needed at this project's scale). Each step is a small, ordered,
// idempotent-by-construction (via user_version gating, not `IF NOT
// EXISTS`) unit of schema change. This replaces the previous
// `CREATE TABLE IF NOT EXISTS`-as-the-only-upgrade-mechanism pattern,
// which could never express "add a column to an existing table" and
// silently no-op'd on any DB that already had the tables from an older
// shape.
export interface Migration {
  version: number;
  description: string;
  up: (db: Db) => void;
}

// Each step reproduces exactly the schema change a real historical
// commit made to the old inline `SCHEMA` string in db.ts (see git log on
// that file): 11414ca (Etap 1 base tables), 7057a9f (Etap 3 accounts),
// 0714491 (Etap 4 offline-alert marker). Step 4 is new (see C6 in the
// hardening task) and is not tied to a past commit.
// Steps 1, 2 and 4 use `IF NOT EXISTS` / a pre-check (step 3) even though
// C1 replaces "IF NOT EXISTS as the only upgrade mechanism" — this is not
// a contradiction: every server deployed before this migration runner
// existed ran the OLD inline `CREATE TABLE IF NOT EXISTS` script on every
// startup, so its real on-disk schema can already match any of these
// steps while `user_version` is still 0 (SQLite's default for a DB that
// predates any `PRAGMA user_version` write). Without the guards, step 1
// would fail with "table servers already exists" on every single
// pre-existing production DB the very first time this code ships. The
// guards only run once — after a DB is stamped at the latest version,
// later migrations added going forward do not need them (a genuinely
// new step targets a schema shape that cannot already exist).
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Etap 1: base servers + events tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          institution_code TEXT NOT NULL,
          product_type TEXT NOT NULL CHECK (product_type IN ('LIMS', 'VETOFFICE')),
          hostname TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')) DEFAULT 'pending',
          api_key_hash TEXT,
          pending_api_key TEXT,
          bravo_version TEXT,
          created_at TEXT NOT NULL,
          approved_at TEXT,
          last_seen_at TEXT,
          last_heartbeat_at TEXT
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          server_id TEXT NOT NULL REFERENCES servers(id),
          category TEXT NOT NULL CHECK (category IN ('backup', 'maintenance', 'health', 'heartbeat')),
          severity TEXT NOT NULL CHECK (severity IN ('SUCCESS', 'WARNING', 'ERROR', 'CRITICAL')),
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_server_created ON events (server_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);
      `);
    },
  },
  {
    version: 2,
    description: 'Etap 3: local accounts (users, sessions)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
      `);
    },
  },
  {
    version: 3,
    description: 'Etap 4: offline-alert dedup marker on servers',
    up: (db) => {
      // Plain ALTER TABLE ADD COLUMN has no "IF NOT EXISTS" form in
      // SQLite, so the guard is an explicit column-existence check
      // instead (see the block comment above MIGRATIONS for why this
      // guard is needed at all).
      const columns = db.pragma('table_info(servers)') as Array<{ name: string }>;
      const hasColumn = columns.some((c) => c.name === 'offline_alerted_at');
      if (!hasColumn) {
        db.exec('ALTER TABLE servers ADD COLUMN offline_alerted_at TEXT;');
      }
    },
  },
  {
    version: 4,
    description: 'Composite index to support latest-event-per-category lookups',
    up: (db) => {
      // Backs repository.ts's listLatestEventPerCategory(ForAllServers):
      // a correlated subquery filtering on (server_id, category) and
      // ordering by (created_at DESC, id DESC) LIMIT 1 for every row in
      // the outer scan. Without this index the existing
      // idx_events_server_created (server_id, created_at) index cannot
      // satisfy the `category` predicate, so SQLite falls back to
      // scanning every event row per server for each correlated lookup.
      // This composite index lets the subquery resolve as a single
      // index range seek instead.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_events_server_category_created
        ON events (server_id, category, created_at DESC, id DESC);
      `);
    },
  },
  {
    version: 5,
    description: 'Enrollment claim hash + pending-key reveal TTL on servers (D1/D3/D5)',
    up: (db) => {
      // See the block comment above MIGRATIONS for why this is a
      // column-existence guard rather than a bare ALTER TABLE: a
      // pre-existing DB may already be at a schema shape close to this
      // one from before the migration runner existed. That is not the
      // case here (this step has no historical inline-SCHEMA
      // counterpart), but the guard costs nothing and keeps every step
      // in this file re-runnable the same way.
      const columns = db.pragma('table_info(servers)') as Array<{ name: string }>;
      const names = new Set(columns.map((c) => c.name));
      if (!names.has('enrollment_claim_hash')) {
        db.exec('ALTER TABLE servers ADD COLUMN enrollment_claim_hash TEXT;');
      }
      if (!names.has('pending_api_key_expires_at')) {
        db.exec('ALTER TABLE servers ADD COLUMN pending_api_key_expires_at TEXT;');
      }
    },
  },
  {
    version: 6,
    description: 'admin_actions audit trail for approve/revoke/reissue (D4)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL CHECK (action IN ('approve', 'revoke', 'reissue')),
          server_id TEXT NOT NULL REFERENCES servers(id),
          admin_user_id TEXT NOT NULL REFERENCES users(id),
          reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_admin_actions_server_created ON admin_actions (server_id, created_at);
      `);
    },
  },
  {
    version: 7,
    description: 'Event envelope (eventId/occurredAt) + idempotent ingestion (E4/E5/E7)',
    up: (db) => {
      // event_id/occurred_at are nullable: older agents (pre-outbox) send
      // neither, and existing rows have neither — idempotency and
      // occurred-vs-received distinction are best-effort improvements
      // for agents that supply them, not a breaking requirement for
      // agents that don't (yet).
      const columns = db.pragma('table_info(events)') as Array<{ name: string }>;
      const names = new Set(columns.map((c) => c.name));
      if (!names.has('event_id')) {
        db.exec('ALTER TABLE events ADD COLUMN event_id TEXT;');
      }
      if (!names.has('occurred_at')) {
        db.exec('ALTER TABLE events ADD COLUMN occurred_at TEXT;');
      }
      // Partial unique index (event_id IS NOT NULL only) — enforces
      // idempotent ingestion (UNIQUE(server_id, event_id)) for agents
      // that supply an eventId, without constraining rows that don't.
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_server_eventid_unique
        ON events (server_id, event_id) WHERE event_id IS NOT NULL;
      `);
    },
  },
];

// Runs every migration whose version is greater than the DB's current
// `user_version`, strictly in ascending order, each wrapped in its own
// transaction. `db.transaction()` (better-sqlite3) issues BEGIN/COMMIT
// and auto-ROLLBACKs on a thrown error, so a failing step leaves the
// schema exactly as it was before that step started — never partially
// applied — and `user_version` is only advanced as part of the same
// transaction as the step's DDL, so it is never bumped for a step that
// didn't fully succeed.
//
// Caveat (verified, not assumed): SQLite supports transactional DDL for
// CREATE TABLE / CREATE INDEX / ALTER TABLE ADD COLUMN — the statements
// used by every step above — and PRAGMA user_version writes to the DB
// header, which also participates in the enclosing transaction and rolls
// back with it. This does NOT generalize to every PRAGMA: e.g.
// `journal_mode` cannot be changed inside a transaction and must run
// (and does run, in db.ts, before migrations start) outside one. It also
// does not generalize to `VACUUM` or to some ALTER TABLE forms in older
// SQLite versions (e.g. table-rebuilding RENAME/DROP COLUMN semantics
// pre-3.35) — none of which are used by the steps above.
//
// A thrown error here is intentionally left uncaught: `openDb()` calls
// this synchronously at module load (see src/index.ts), so an error
// propagates straight out and aborts process startup. Nothing in this
// codebase should ever wrap this call in a try/catch that logs and
// continues — a partially-migrated schema must never be treated as
// usable.
export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  const ordered = [...migrations].sort((a, b) => a.version - b.version);

  for (const migration of ordered) {
    if (migration.version <= currentVersion) {
      continue;
    }
    const applyStep = db.transaction(() => {
      migration.up(db);
      // PRAGMA can't take a bound parameter; version is our own
      // integer literal, never user input.
      db.pragma(`user_version = ${migration.version}`);
    });
    try {
      applyStep();
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new Error(
        `Migration ${migration.version} ("${migration.description}") failed — startup aborted, DB left at user_version=${currentVersion < migration.version ? db.pragma('user_version', { simple: true }) : currentVersion}: ${cause.message}`,
        { cause },
      );
    }
  }
}
