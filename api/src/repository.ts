import type { Db } from './db.js';
import type { EventCategory, EventPayload, ProductType, ServerStatus, Severity } from './schemas.js';

export interface ServerRow {
  id: string;
  institution_code: string;
  product_type: ProductType;
  hostname: string;
  status: ServerStatus;
  api_key_hash: string | null;
  pending_api_key: string | null;
  bravo_version: string | null;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
}

export interface EventRow {
  id: number;
  server_id: string;
  category: EventCategory | 'heartbeat';
  severity: Severity;
  payload: string;
  created_at: string;
}

export class OperationsRepository {
  constructor(private readonly db: Db) {}

  // Idempotent by design: an agent that retries POST /enroll after a
  // network hiccup must not create a second row or reset an
  // already-approved server back to pending.
  upsertPendingServer(input: {
    id: string;
    institutionCode: string;
    productType: ProductType;
    hostname: string;
    now: string;
  }): ServerRow {
    const existing = this.getServer(input.id);
    if (existing) {
      this.db
        .prepare('UPDATE servers SET hostname = ?, institution_code = ? WHERE id = ?')
        .run(input.hostname, input.institutionCode, input.id);
      return this.getServer(input.id)!;
    }
    this.db
      .prepare(
        `INSERT INTO servers (id, institution_code, product_type, hostname, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(input.id, input.institutionCode, input.productType, input.hostname, input.now);
    return this.getServer(input.id)!;
  }

  getServer(id: string): ServerRow | undefined {
    return this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow | undefined;
  }

  listServers(): ServerRow[] {
    return this.db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all() as ServerRow[];
  }

  // Sets the freshly generated key as both the retrievable plaintext
  // (consumed exactly once by the agent's enrollment poll) and its
  // stored hash (used for every subsequent request's auth check).
  approveServer(id: string, apiKey: string, apiKeyHash: string, now: string): ServerRow | undefined {
    this.db
      .prepare(
        `UPDATE servers
         SET status = 'approved', api_key_hash = ?, pending_api_key = ?, approved_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(apiKeyHash, apiKey, now, id);
    return this.getServer(id);
  }

  // Reveal-once: the plaintext key is returned to the polling agent
  // exactly one time, then cleared. Losing it after that means
  // re-enrollment, by design — the server never persists a plaintext key
  // longer than it has to.
  consumePendingApiKey(id: string): string | undefined {
    const server = this.getServer(id);
    if (!server?.pending_api_key) {
      return undefined;
    }
    this.db.prepare('UPDATE servers SET pending_api_key = NULL WHERE id = ?').run(id);
    return server.pending_api_key;
  }

  findApprovedServerByApiKeyHash(hash: string): ServerRow | undefined {
    return this.db
      .prepare("SELECT * FROM servers WHERE api_key_hash = ? AND status = 'approved'")
      .get(hash) as ServerRow | undefined;
  }

  touchLastSeen(id: string, now: string): void {
    this.db.prepare('UPDATE servers SET last_seen_at = ? WHERE id = ?').run(now, id);
  }

  touchHeartbeat(id: string, now: string, bravoVersion: string | undefined): void {
    this.db
      .prepare(
        `UPDATE servers
         SET last_heartbeat_at = ?, last_seen_at = ?, bravo_version = COALESCE(?, bravo_version)
         WHERE id = ?`,
      )
      .run(now, now, bravoVersion ?? null, id);
  }

  insertEvent(input: {
    serverId: string;
    category: EventCategory | 'heartbeat';
    severity: Severity;
    payload: EventPayload | Record<string, never>;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO events (server_id, category, severity, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.serverId, input.category, input.severity, JSON.stringify(input.payload), input.now);
  }

  listRecentEvents(serverId: string, limit: number): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE server_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(serverId, limit) as EventRow[];
  }

  // Retention (grilling Q15: keep 90 days of history). Returns the
  // deleted row count so the caller can log it rather than delete
  // silently.
  deleteEventsOlderThan(cutoffIso: string): number {
    const result = this.db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoffIso);
    return result.changes;
  }
}
