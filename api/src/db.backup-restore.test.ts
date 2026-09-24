import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase } from './cli/backup.js';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';

const SERVER_ID = '77777777-7777-4777-8777-777777777777';

describe('backupDatabase (WAL-safe restore round trip)', () => {
  let dir: string;
  let livePath: string;
  let backupPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ops-db-backup-test-'));
    livePath = path.join(dir, 'operations.sqlite3');
    backupPath = path.join(dir, 'backups', 'operations-backup.sqlite3');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a backup that survives the live copy being corrupted, and round-trips all major tables', async () => {
    // Arrange: a live DB with representative rows across servers, events,
    // users and sessions.
    const liveDb = openDb(livePath);
    const repository = new OperationsRepository(liveDb);

    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      claim: 'test-claim',
      now: '2026-01-01T00:00:00.000Z',
    });
    repository.approveServer(SERVER_ID, 'plaintext-key', 'hashed-key', '2026-01-01T00:05:00.000Z');
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'backup',
      severity: 'SUCCESS',
      payload: { message: 'nightly backup ok' },
      now: '2026-01-02T00:00:00.000Z',
    });
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'health',
      severity: 'WARNING',
      payload: { message: 'disk getting full' },
      now: '2026-01-03T00:00:00.000Z',
    });
    const user = repository.createUser({
      id: randomUUID(),
      username: 'operator',
      passwordHash: 'hashed-password',
      role: 'admin',
      now: '2026-01-01T00:00:00.000Z',
    });
    repository.createSession({
      tokenHash: 'session-token-hash',
      userId: user.id,
      now: '2026-01-04T00:00:00.000Z',
      expiresAt: '2026-01-05T00:00:00.000Z',
    });

    // Act: back up using the canonical Online Backup API path, then
    // simulate the live file being destroyed (disk failure, accidental
    // delete, whatever) — this is the scenario the backup exists for.
    await backupDatabase(livePath, backupPath);
    liveDb.close();

    expect(existsSync(backupPath)).toBe(true);
    writeFileSync(livePath, 'this is not a sqlite file, the live copy is gone/corrupted');

    // Restore, operationally: point a connection at the backup file (the
    // doc also covers copying it back over the live path — equivalent
    // for verification purposes).
    const restoredDb = new Database(backupPath, { readonly: true });

    const integrity = restoredDb.pragma('integrity_check', { simple: true });
    expect(integrity).toBe('ok');

    const restoredRepository = new OperationsRepository(restoredDb);
    const restoredServer = restoredRepository.getServer(SERVER_ID);
    expect(restoredServer?.hostname).toBe('HOUSE-LIMS-01');
    expect(restoredServer?.status).toBe('approved');
    expect(restoredServer?.api_key_hash).toBe('hashed-key');

    const restoredEvents = restoredRepository.listRecentEvents(SERVER_ID, 10);
    expect(restoredEvents).toHaveLength(2);
    expect(restoredEvents.map((e) => JSON.parse(e.payload).message).sort()).toEqual([
      'disk getting full',
      'nightly backup ok',
    ]);

    const restoredUser = restoredRepository.getUserByUsername('operator');
    expect(restoredUser?.id).toBe(user.id);
    const restoredSession = restoredRepository.getSessionByTokenHash('session-token-hash', '2026-01-04T12:00:00.000Z');
    expect(restoredSession?.user.username).toBe('operator');

    restoredDb.close();
  });
});
