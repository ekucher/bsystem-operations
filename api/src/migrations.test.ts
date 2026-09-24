import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { MIGRATIONS, runMigrations, type Migration } from './migrations.js';
import { OperationsRepository } from './repository.js';

const SERVER_ID = '55555555-5555-4555-8555-555555555555';

// Builds a raw, no-migrations-applied DB shaped exactly like the Etap 1
// schema (before users/sessions and before offline_alerted_at existed),
// the way a server that was first deployed on that early code base would
// actually look today. No literal .sqlite3 binary fixture needed —
// constructing it programmatically from the same SQL the old inline
// schema used is simpler to keep in sync.
function buildEtap1ShapeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE servers (
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

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL REFERENCES servers(id),
      category TEXT NOT NULL CHECK (category IN ('backup', 'maintenance', 'health', 'heartbeat')),
      severity TEXT NOT NULL CHECK (severity IN ('SUCCESS', 'WARNING', 'ERROR', 'CRITICAL')),
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_events_server_created ON events (server_id, created_at);
    CREATE INDEX idx_events_created ON events (created_at);
  `);
  // A real Etap-1-era DB predates the migration runner entirely, so its
  // user_version is still the SQLite default of 0.
  db.exec('INSERT INTO servers (id, institution_code, product_type, hostname, status, created_at) VALUES '
    + `('${SERVER_ID}', '01234567', 'LIMS', 'HOUSE-LIMS-01', 'approved', '2024-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO events (server_id, category, severity, payload, created_at) VALUES
    ('${SERVER_ID}', 'backup', 'SUCCESS', '{"message":"pre-migration event"}', '2024-01-01T00:00:00.000Z')`);
  return db;
}

function tableColumns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
}

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
}

describe('runMigrations — upgrading an old-shape DB', () => {
  it('brings a pre-Etap-3/4 DB up to the latest schema without losing existing rows', () => {
    const db = buildEtap1ShapeDb();
    expect(db.pragma('user_version', { simple: true })).toBe(0);

    runMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    expect(tableNames(db).sort()).toEqual(['admin_actions', 'events', 'servers', 'sessions', 'users']);
    expect(tableColumns(db, 'servers')).toContain('offline_alerted_at');
    expect(tableColumns(db, 'servers')).toContain('enrollment_claim_hash');
    expect(tableColumns(db, 'servers')).toContain('pending_api_key_expires_at');

    // Pre-existing data survived the upgrade untouched.
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(SERVER_ID) as { offline_alerted_at: unknown };
    expect(server).toBeDefined();
    expect(server.offline_alerted_at).toBeNull();
    const event = db.prepare('SELECT * FROM events WHERE server_id = ?').get(SERVER_ID) as { payload: string };
    expect(JSON.parse(event.payload).message).toBe('pre-migration event');

    // The composite index from step 4 exists.
    const indexNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(indexNames).toContain('idx_events_server_category_created');

    // The repository layer works against the upgraded DB.
    const repository = new OperationsRepository(db);
    expect(repository.getServer(SERVER_ID)?.hostname).toBe('HOUSE-LIMS-01');
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'maintenance',
      severity: 'SUCCESS',
      payload: { message: 'post-migration event' },
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(repository.listRecentEvents(SERVER_ID, 10)).toHaveLength(2);
    const user = repository.createUser({
      id: '66666666-6666-4666-8666-666666666666',
      username: 'operator',
      passwordHash: 'hash',
      role: 'admin',
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(repository.getUserByUsername('operator')?.id).toBe(user.id);

    db.close();
  });

  it('running migrations a second time immediately after the full old-shape upgrade is a clean no-op', () => {
    const db = buildEtap1ShapeDb();
    runMigrations(db);
    const versionAfterFirst = db.pragma('user_version', { simple: true });
    const columnsAfterFirst = tableColumns(db, 'servers');

    expect(() => runMigrations(db)).not.toThrow();

    expect(db.pragma('user_version', { simple: true })).toBe(versionAfterFirst);
    expect(tableColumns(db, 'servers')).toEqual(columnsAfterFirst);
    expect(tableNames(db).sort()).toEqual(['admin_actions', 'events', 'servers', 'sessions', 'users']);
    // Pre-existing data still intact after the redundant second run.
    const server = db.prepare('SELECT hostname FROM servers WHERE id = ?').get(SERVER_ID) as { hostname: string };
    expect(server.hostname).toBe('HOUSE-LIMS-01');

    db.close();
  });
});

describe('runMigrations — fresh empty DB', () => {
  it('migrates a brand new file to the latest schema and works end to end', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);

    const repository = new OperationsRepository(db);
    const result = repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'VETOFFICE',
      hostname: 'HOUSE-VET-01',
      claim: 'test-claim',
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(result.outcome).toBe('created');
    expect(result.server.status).toBe('pending');
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'health',
      severity: 'WARNING',
      payload: { message: 'fresh db event' },
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(repository.listRecentEvents(SERVER_ID, 10)).toHaveLength(1);
  });
});

describe('runMigrations — idempotency', () => {
  it('running twice in a row does not error or double-apply', () => {
    const db = openDb(':memory:');
    const versionAfterFirst = db.pragma('user_version', { simple: true });

    expect(() => runMigrations(db)).not.toThrow();

    expect(db.pragma('user_version', { simple: true })).toBe(versionAfterFirst);
    // No duplicate index/table creation errors, and only one copy of
    // each table exists (sqlite_master would contain duplicates or the
    // second run would have thrown on CREATE TABLE without IF NOT
    // EXISTS if steps had re-run).
    expect(tableNames(db).sort()).toEqual(['admin_actions', 'events', 'servers', 'sessions', 'users']);
  });
});

describe('runMigrations — Wave-2 C1: legacy plaintext pending_api_key cleanup', () => {
  it('clears a pre-migration-5 plaintext pending key (NULL expiry) and readPendingApiKey refuses it', () => {
    const db = buildEtap1ShapeDb();
    // Simulate a server that was approved under the OLD reveal-once
    // model, before migration 5 introduced pending_api_key_expires_at:
    // a plaintext pending_api_key with no expiry at all.
    db.exec(
      `UPDATE servers SET pending_api_key = 'legacy-plaintext-key-never-expires' WHERE id = '${SERVER_ID}'`,
    );

    runMigrations(db);

    const row = db.prepare('SELECT pending_api_key, pending_api_key_expires_at FROM servers WHERE id = ?').get(SERVER_ID) as {
      pending_api_key: string | null;
      pending_api_key_expires_at: string | null;
    };
    expect(row.pending_api_key).toBeNull();
    expect(row.pending_api_key_expires_at).toBeNull();

    const repository = new OperationsRepository(db);
    expect(repository.readPendingApiKey(SERVER_ID, '2026-01-01T00:00:00.000Z')).toBeUndefined();

    db.close();
  });

  it('does not touch a pending key that already has a valid (non-NULL) expiry', () => {
    const db = openDb(':memory:');
    const repository = new OperationsRepository(db);
    const serverId = '77777777-7777-4777-8777-777777777777';
    repository.upsertPendingServer({
      id: serverId,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOST-fresh',
      now: '2026-01-01T00:00:00.000Z',
    });
    const approved = repository.approveServer(serverId, 'plaintext-key', 'hash', '2026-01-01T00:00:00.000Z');
    expect(approved?.pending_api_key).toBe('plaintext-key');
    expect(approved?.pending_api_key_expires_at).not.toBeNull();

    // Migrations already ran (openDb calls runMigrations); running again
    // must not clear a well-formed, TTL-bounded pending key.
    runMigrations(db);
    expect(repository.getServer(serverId)?.pending_api_key).toBe('plaintext-key');
  });
});

describe('runMigrations — Wave-2 C2: fail closed on a newer-than-supported schema version', () => {
  it('throws immediately and applies no steps when user_version exceeds the latest known migration', () => {
    const db = openDb(':memory:');
    const latest = MIGRATIONS[MIGRATIONS.length - 1].version;
    db.pragma(`user_version = ${latest + 1}`);

    expect(() => runMigrations(db)).toThrow(
      new RegExp(`Database schema version ${latest + 1} is newer than supported version ${latest}. Refusing to start\\.`),
    );
    // Version untouched by the failed attempt (not further bumped, not
    // reset) and no migration steps ran (nothing to check for change here
    // since every step is idempotent, but the version itself must stay
    // exactly what it was).
    expect(db.pragma('user_version', { simple: true })).toBe(latest + 1);
  });
});

describe('runMigrations — failure safety', () => {
  it('stops at the failing step, does not bump user_version, and does not apply later steps', () => {
    const db = new Database(':memory:');
    const boom: Migration = {
      version: 1,
      description: 'always fails',
      up: () => {
        throw new Error('simulated migration failure');
      },
    };
    const neverReached: Migration = {
      version: 2,
      description: 'should never run',
      up: (d) => {
        d.exec('CREATE TABLE should_not_exist (id INTEGER)');
      },
    };

    expect(() => runMigrations(db, [boom, neverReached])).toThrow(/simulated migration failure/);
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    expect(tableNames(db)).toEqual([]);
  });

  it('leaves partial DDL from the failing step itself rolled back', () => {
    const db = new Database(':memory:');
    const partiallyFails: Migration = {
      version: 1,
      description: 'creates a table then fails before commit',
      up: (d) => {
        d.exec('CREATE TABLE partial (id INTEGER)');
        throw new Error('boom after DDL');
      },
    };

    expect(() => runMigrations(db, [partiallyFails])).toThrow(/boom after DDL/);
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    // The CREATE TABLE from within the same failed transaction was
    // rolled back — SQLite's transactional DDL guarantee.
    expect(tableNames(db)).toEqual([]);
  });
});
