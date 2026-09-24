import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('OperationsRepository.deleteEventsOlderThan', () => {
  it('returns 0 when there is nothing to delete', () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    expect(repository.deleteEventsOlderThan(isoDaysAgo(90))).toBe(0);
  });

  it('deletes only events strictly older than the 90-day cutoff, keeping recent ones', () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: '33333333-3333-4333-8333-333333333333',
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-02',
      claim: 'test-claim',
      now: isoDaysAgo(100),
    });

    repository.insertEvent({
      serverId: '33333333-3333-4333-8333-333333333333',
      category: 'backup',
      severity: 'SUCCESS',
      payload: { message: 'старий' },
      now: isoDaysAgo(91),
    });
    repository.insertEvent({
      serverId: '33333333-3333-4333-8333-333333333333',
      category: 'backup',
      severity: 'SUCCESS',
      payload: { message: 'свіжий' },
      now: isoDaysAgo(1),
    });

    const deleted = repository.deleteEventsOlderThan(isoDaysAgo(90));
    expect(deleted).toBe(1);

    const remaining = repository.listRecentEvents('33333333-3333-4333-8333-333333333333', 10);
    expect(remaining).toHaveLength(1);
    expect(JSON.parse(remaining[0].payload).message).toBe('свіжий');
  });
});
