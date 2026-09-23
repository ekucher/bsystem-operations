import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

const SCHEMA = `
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
  last_heartbeat_at TEXT,
  -- Etap 4: set when an offline Discord alert has been sent for the
  -- server's CURRENT offline episode; cleared on recovery. Dedup marker
  -- — without it every offline-check tick would re-alert the same
  -- already-known-offline server.
  offline_alerted_at TEXT
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

-- Etap 3: local accounts (grilling — role сама по собі окрема від
-- джерела автентифікації, щоб пізніше мігрувати на authentik OIDC без
-- переписування RBAC; v1 auth source лишається password_hash тут).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL
);

-- Opaque bearer token in an httpOnly cookie; only its SHA-256 digest is
-- stored (same trust model as servers.api_key_hash) so a DB dump alone
-- cannot be replayed as a valid session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
`;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
