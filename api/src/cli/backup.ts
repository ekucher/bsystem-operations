#!/usr/bin/env node
// WAL-safe backup using SQLite's Online Backup API, exposed by
// better-sqlite3 as db.backup(). A plain file copy (`cp`/`copy`) of a
// WAL-mode database is NOT safe: with concurrent writers, the main DB
// file, -wal, and -shm files can be copied at inconsistent points
// relative to each other, producing a corrupt or torn snapshot. The
// Online Backup API instead copies pages through SQLite itself while
// coordinating with any in-progress writers, producing a single
// consistent snapshot file every time.
//
// Usage: npm run backup --workspace=api -- --out /path/to/backups/operations-<timestamp>.sqlite3
// See docs/backup-restore.md for the full operational procedure.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';

interface ParsedArgs {
  out?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out.out = argv[++i];
    }
  }
  return out;
}

// Exported so the restore-verification test (db.backup-restore.test.ts)
// can call it directly against a temp DB/path instead of shelling out.
export async function backupDatabase(sourceDbPath: string, destinationPath: string): Promise<void> {
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  const db = openDb(sourceDbPath);
  try {
    await db.backup(destinationPath);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    // eslint-disable-next-line no-console
    console.error('Usage: backup --out <path-to-backup-file>');
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  await backupDatabase(config.dbPath, args.out);
  // eslint-disable-next-line no-console
  console.log(`Backup written to ${args.out}`);
}

// Only run when invoked as a script (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Backup failed:', err);
    process.exitCode = 1;
  });
}
