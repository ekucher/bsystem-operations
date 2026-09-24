import type { Db } from './db.js';
import type { EventCategory, EventPayload, ProductType, ServerStatus, Severity, UserRole } from './schemas.js';

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
  offline_alerted_at: string | null;
}

export interface EventRow {
  id: number;
  server_id: string;
  category: EventCategory | 'heartbeat';
  severity: Severity;
  payload: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export interface SessionWithUser {
  token_hash: string;
  expires_at: string;
  user: UserRow;
}

// Allow-list for anything a ServerRow-shaped object ships to an HTTP
// response. api_key_hash / pending_api_key deliberately have no
// counterpart here — a server row must never be spread directly into
// res.json() (see routes/admin.ts), or a hash (or the reveal-once
// plaintext key) leaks to whoever can read that endpoint.
export interface PublicServer {
  id: string;
  institution_code: string;
  product_type: ProductType;
  hostname: string;
  status: ServerStatus;
  bravo_version: string | null;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
}

export function toPublicServer(server: ServerRow): PublicServer {
  return {
    id: server.id,
    institution_code: server.institution_code,
    product_type: server.product_type,
    hostname: server.hostname,
    status: server.status,
    bravo_version: server.bravo_version,
    created_at: server.created_at,
    approved_at: server.approved_at,
    last_seen_at: server.last_seen_at,
    last_heartbeat_at: server.last_heartbeat_at,
  };
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

  // Latest event per (server, category) across the WHOLE fleet in a
  // single query — the overview page needs this for every server at
  // once, and an N+1 per-server query would not scale to ~50 servers on
  // every poll. Correlated subquery rather than a window function: keeps
  // the SQL portable across whatever sqlite3 version better-sqlite3
  // bundles, and the events table stays small enough (90-day retention)
  // for this to be cheap.
  listLatestEventPerCategoryForAllServers(): EventRow[] {
    return this.db
      .prepare(
        `SELECT e.* FROM events e
         WHERE e.id = (
           SELECT e2.id FROM events e2
           WHERE e2.server_id = e.server_id AND e2.category = e.category
           ORDER BY e2.created_at DESC, e2.id DESC
           LIMIT 1
         )`,
      )
      .all() as EventRow[];
  }

  listLatestEventPerCategory(serverId: string): EventRow[] {
    return this.db
      .prepare(
        `SELECT e.* FROM events e
         WHERE e.server_id = ? AND e.id = (
           SELECT e2.id FROM events e2
           WHERE e2.server_id = e.server_id AND e2.category = e.category
           ORDER BY e2.created_at DESC, e2.id DESC
           LIMIT 1
         )`,
      )
      .all(serverId) as EventRow[];
  }

  // ===== Etap 3: local accounts / sessions =====

  createUser(input: { id: string; username: string; passwordHash: string; role: UserRole; now: string }): UserRow {
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.username, input.passwordHash, input.role, input.now);
    return this.getUserByUsername(input.username)!;
  }

  getUserByUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  }

  getUserById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  createSession(input: { tokenHash: string; userId: string; now: string; expiresAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.tokenHash, input.userId, input.now, input.expiresAt);
  }

  // Expiry is checked here (not left to the caller) so every call site
  // gets the same "expired session behaves like no session" semantics —
  // an expired row is treated as absent rather than silently trusted.
  getSessionByTokenHash(tokenHash: string, nowIso: string): SessionWithUser | undefined {
    const row = this.db
      .prepare(
        `SELECT s.token_hash, s.expires_at, u.id as user_id, u.username, u.password_hash, u.role, u.created_at as user_created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, nowIso) as
      | {
          token_hash: string;
          expires_at: string;
          user_id: string;
          username: string;
          password_hash: string;
          role: UserRole;
          user_created_at: string;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      token_hash: row.token_hash,
      expires_at: row.expires_at,
      user: {
        id: row.user_id,
        username: row.username,
        password_hash: row.password_hash,
        role: row.role,
        created_at: row.user_created_at,
      },
    };
  }

  deleteSessionByTokenHash(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteExpiredSessions(nowIso: string): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
    return result.changes;
  }

  // ===== Etap 4: offline-alert dedup marker =====

  markOfflineAlerted(id: string, now: string): void {
    this.db.prepare('UPDATE servers SET offline_alerted_at = ? WHERE id = ?').run(now, id);
  }

  clearOfflineAlert(id: string): void {
    this.db.prepare('UPDATE servers SET offline_alerted_at = NULL WHERE id = ?').run(id);
  }
}
