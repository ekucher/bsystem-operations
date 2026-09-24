import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrations.js';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  // journal_mode is a connection-level pragma that SQLite refuses to
  // change inside a transaction, so it's set here, before any migration
  // runs — never inside migrations.ts's per-step transactions.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Bring the schema from whatever it was (including "brand new, empty
  // file") up to the latest version. Throws (and aborts startup, see
  // src/index.ts) if any step fails — never silently continues.
  runMigrations(db);
  return db;
}
