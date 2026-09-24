import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';

const SERVER_ID = '55555555-5555-4555-8555-555555555555';

function iso(offsetMinutesFromNow: number): string {
  return new Date(Date.now() + offsetMinutesFromNow * 60_000).toISOString();
}

function setUpServer(repository: OperationsRepository): void {
  repository.upsertPendingServer({
    id: SERVER_ID,
    institutionCode: '01234567',
    productType: 'LIMS',
    hostname: 'HOUSE-LIMS-03',
    now: iso(-1000),
  });
}

// D1/D2/D4 (Wave 2 hardening): a durable agent-side outbox can deliver
// events late and out of order. The "latest per category" query must key
// off when the event actually HAPPENED (occurred_at), not when the API
// received it (created_at) — otherwise a stale event that is merely
// delivered last can clobber a genuinely newer one.
describe('OperationsRepository latest-event-per-category ordering (occurred_at vs created_at)', () => {
  it('resolves to the event with the latest occurred_at, not the one inserted last', () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    setUpServer(repository);

    // Master-task scenario, reproduced exactly:
    // 1. An ERROR that "happened" at 10:00 but is delivered late — its row
    //    is inserted into the DB AFTER the 11:00 SUCCESS below, mimicking
    //    an outage-delayed delivery.
    // 2. An 11:00 SUCCESS delivered promptly (inserted first).
    // 3. An even-older ERROR (09:00) delivered very late (inserted last of
    //    all three).
    //
    // Insertion (created_at / received) order: SUCCESS(11:00), then
    // ERROR(10:00), then ERROR(09:00) — i.e. created_at DESC would put
    // ERROR(09:00) "on top", which is exactly the bug this fixes.
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'backup',
      severity: 'SUCCESS',
      payload: { message: '11:00 success, delivered promptly' },
      now: '2026-01-01T11:05:00.000Z', // received first
      occurredAt: '2026-01-01T11:00:00.000Z',
      eventId: 'evt-1100-success',
    });
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'backup',
      severity: 'ERROR',
      payload: { message: '10:00 error, delivered late' },
      now: '2026-01-01T12:00:00.000Z', // received AFTER the 11:00 success above
      occurredAt: '2026-01-01T10:00:00.000Z',
      eventId: 'evt-1000-error',
    });
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'backup',
      severity: 'ERROR',
      payload: { message: '09:00 error, delivered even later' },
      now: '2026-01-01T13:00:00.000Z', // received last of all three
      occurredAt: '2026-01-01T09:00:00.000Z',
      eventId: 'evt-0900-error',
    });

    const latest = repository.listLatestEventPerCategory(SERVER_ID);
    expect(latest).toHaveLength(1);
    expect(latest[0].severity).toBe('SUCCESS');
    expect(latest[0].event_id).toBe('evt-1100-success');
    expect(JSON.parse(latest[0].payload).message).toBe('11:00 success, delivered promptly');

    // Same guarantee for the fleet-wide variant used by the overview page.
    const latestForAll = repository.listLatestEventPerCategoryForAllServers();
    expect(latestForAll).toHaveLength(1);
    expect(latestForAll[0].event_id).toBe('evt-1100-success');
  });

  it('falls back to created_at ordering when occurred_at is missing (pre-outbox agents)', () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    setUpServer(repository);

    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'maintenance',
      severity: 'WARNING',
      payload: { message: 'older, no occurredAt' },
      now: '2026-01-01T09:00:00.000Z',
    });
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'maintenance',
      severity: 'SUCCESS',
      payload: { message: 'newer, no occurredAt' },
      now: '2026-01-01T10:00:00.000Z',
    });

    const latest = repository.listLatestEventPerCategory(SERVER_ID);
    expect(latest).toHaveLength(1);
    expect(latest[0].severity).toBe('SUCCESS');
  });

  it('uses created_at, id as the tie-breaker when occurred_at is identical', () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    setUpServer(repository);

    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'health',
      severity: 'WARNING',
      payload: { message: 'first row, same occurredAt' },
      now: '2026-01-01T09:00:00.000Z',
      occurredAt: '2026-01-01T09:00:00.000Z',
    });
    repository.insertEvent({
      serverId: SERVER_ID,
      category: 'health',
      severity: 'ERROR',
      payload: { message: 'second row, same occurredAt' },
      now: '2026-01-01T09:00:00.000Z',
      occurredAt: '2026-01-01T09:00:00.000Z',
    });

    const latest = repository.listLatestEventPerCategory(SERVER_ID);
    expect(latest).toHaveLength(1);
    // Higher id (inserted second) wins the tie-break.
    expect(latest[0].payload).toContain('second row');
  });
});
