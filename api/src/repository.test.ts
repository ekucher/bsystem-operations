import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';

// Wave-2 C3/C4: approveServerWithAudit / revokeServerWithAudit /
// reissueApiKeyWithAudit wrap the state transition and the admin_actions
// insert in a single db.transaction() (better-sqlite3), so either both
// persist or neither does. These tests force the audit insert to fail
// (admin_actions.admin_user_id has a FOREIGN KEY REFERENCES users(id),
// and foreign_keys = ON is set in db.ts) and assert the state transition
// is rolled back too — not just the audit row.
describe('Wave-2 C3: atomic lifecycle + audit', () => {
  function setup() {
    const db = openDb(':memory:');
    const repository = new OperationsRepository(db);
    const serverId = randomUUID();
    repository.upsertPendingServer({
      id: serverId,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOST-atomic',
      now: '2026-01-01T00:00:00.000Z',
    });
    // An admin_user_id that does not exist in `users` — any audit insert
    // referencing it violates the FOREIGN KEY constraint.
    const bogusAdminUserId = randomUUID();
    return { db, repository, serverId, bogusAdminUserId };
  }

  it('approveServerWithAudit: rolls back the approval if the audit insert violates a FK constraint', () => {
    const { repository, serverId, bogusAdminUserId } = setup();

    expect(() =>
      repository.approveServerWithAudit({
        id: serverId,
        apiKey: 'plaintext-key',
        apiKeyHash: 'hash',
        adminUserId: bogusAdminUserId,
        now: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // The state transition must NOT have persisted: still 'pending', not
    // 'approved' — proving the UPDATE inside the same transaction as the
    // failed audit insert was rolled back, not just the audit row.
    const server = repository.getServer(serverId);
    expect(server?.status).toBe('pending');
    expect(server?.api_key_hash).toBeNull();
    expect(repository.listAdminActions(serverId)).toHaveLength(0);
  });

  it('revokeServerWithAudit: rolls back the revoke if the audit insert violates a FK constraint', () => {
    const { repository, serverId, bogusAdminUserId } = setup();
    repository.approveServer(serverId, 'plaintext-key', 'hash', '2026-01-01T00:00:00.000Z');

    expect(() =>
      repository.revokeServerWithAudit({
        id: serverId,
        adminUserId: bogusAdminUserId,
        now: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // Still 'approved', not 'revoked' — and the key hash the (attempted)
    // revoke would have cleared is still present.
    const server = repository.getServer(serverId);
    expect(server?.status).toBe('approved');
    expect(server?.api_key_hash).toBe('hash');
    expect(repository.listAdminActions(serverId)).toHaveLength(0);
  });

  it('reissueApiKeyWithAudit: rolls back the reissue if the audit insert violates a FK constraint', () => {
    const { repository, serverId, bogusAdminUserId } = setup();
    repository.approveServer(serverId, 'old-plaintext-key', 'old-hash', '2026-01-01T00:00:00.000Z');

    expect(() =>
      repository.reissueApiKeyWithAudit({
        id: serverId,
        apiKey: 'new-plaintext-key',
        apiKeyHash: 'new-hash',
        adminUserId: bogusAdminUserId,
        now: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // The old key hash must still be the active one — the reissue's
    // UPDATE was rolled back along with the failed audit insert.
    const server = repository.getServer(serverId);
    expect(server?.api_key_hash).toBe('old-hash');
    expect(repository.listAdminActions(serverId)).toHaveLength(0);
  });

  it('approveServerWithAudit: succeeds and records the audit row atomically on the happy path', () => {
    const { repository, serverId } = setup();
    const adminUserId = randomUUID();
    // FK requires a real users row for the happy path.
    repository.createUser({
      id: adminUserId,
      username: 'admin-atomic',
      passwordHash: 'irrelevant',
      role: 'admin',
      now: '2026-01-01T00:00:00.000Z',
    });

    const result = repository.approveServerWithAudit({
      id: serverId,
      apiKey: 'plaintext-key',
      apiKeyHash: 'hash',
      adminUserId,
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(result?.status).toBe('approved');
    const actions = repository.listAdminActions(serverId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: 'approve', admin_user_id: adminUserId });
  });
});
