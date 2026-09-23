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
