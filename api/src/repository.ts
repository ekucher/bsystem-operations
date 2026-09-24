import type { Db } from './db.js';
import { generateClaimToken, hashSecret } from './crypto.js';
import type {
  AdminActionType,
  EventCategory,
  EventPayload,
  ProductType,
  ServerStatus,
  Severity,
  UserRole,
} from './schemas.js';

export interface ServerRow {
  id: string;
  institution_code: string;
  product_type: ProductType;
  hostname: string;
  status: ServerStatus;
  api_key_hash: string | null;
  pending_api_key: string | null;
  pending_api_key_expires_at: string | null;
  enrollment_claim_hash: string | null;
  bravo_version: string | null;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  offline_alerted_at: string | null;
}

export interface AdminActionRow {
  id: number;
  action: AdminActionType;
  server_id: string;
  admin_user_id: string;
  reason: string | null;
  created_at: string;
}

// D3 (agent-enrollment hardening): how long a freshly approved/reissued
// plaintext key stays retrievable via GET /enroll/:serverId before the
// TTL sweep (see retention.ts's schedulePendingKeyCleanup) nulls it out.
// 5 minutes: long enough to cover a couple of retry/backoff cycles if
// the first poll's HTTP response is lost in transit (Finding 4 in the
// hardening brief), short enough that a stolen enrollment claim (D1)
// only has a few minutes of blast radius before the key it could reveal
// is gone — at which point recovery requires an admin-initiated reissue
// (D4), not another unauthenticated poll.
export const PENDING_KEY_TTL_MS = 5 * 60 * 1000;

export interface EventRow {
  id: number;
  server_id: string;
  category: EventCategory | 'heartbeat';
  severity: Severity;
  payload: string;
  created_at: string;
  event_id: string | null;
  occurred_at: string | null;
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
  //
  // D6 fix: identity fields (hostname/institutionCode) are only mutable
  // while the row is still 'pending' — an agent correcting its own
  // not-yet-approved enrollment. Once 'approved' or 'revoked', a repeat
  // POST /enroll must not silently rewrite identity; the caller gets
  // back `outcome: 'locked'` and does nothing to the row. This is the
  // safe-default choice for D6 (reject, don't allow claim-gated
  // identity edits post-approval) — simpler, and an admin action
  // (revoke+reissue) is the correct path for a genuinely re-hostnamed
  // server.
  //
  // D1: every call that is allowed to proceed (fresh row, or a 'pending'
  // row being corrected) rotates the enrollment claim and returns its
  // plaintext once — this doubles as D3's recovery path for a lost
  // POST /enroll response: the agent just re-POSTs and gets a fresh,
  // still-usable claim back.
  upsertPendingServer(input: {
    id: string;
    institutionCode: string;
    productType: ProductType;
    hostname: string;
    now: string;
  }): { outcome: 'created' | 'updated'; server: ServerRow; claimToken: string } | { outcome: 'locked'; server: ServerRow } {
    const existing = this.getServer(input.id);
    if (existing && existing.status !== 'pending') {
      return { outcome: 'locked', server: existing };
    }
    const claimToken = generateClaimToken();
    const claimHash = hashSecret(claimToken);
    if (existing) {
      this.db
        .prepare('UPDATE servers SET hostname = ?, institution_code = ?, enrollment_claim_hash = ? WHERE id = ?')
        .run(input.hostname, input.institutionCode, claimHash, input.id);
      return { outcome: 'updated', server: this.getServer(input.id)!, claimToken };
    }
    this.db
      .prepare(
        `INSERT INTO servers (id, institution_code, product_type, hostname, status, created_at, enrollment_claim_hash)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(input.id, input.institutionCode, input.productType, input.hostname, input.now, claimHash);
    return { outcome: 'created', server: this.getServer(input.id)!, claimToken };
  }

  getServer(id: string): ServerRow | undefined {
    return this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow | undefined;
  }

  listServers(): ServerRow[] {
    return this.db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all() as ServerRow[];
  }

  // Sets the freshly generated key as both the retrievable plaintext
  // (retrievable by the agent's enrollment poll, see readPendingApiKey)
  // and its stored hash (used for every subsequent request's auth
  // check). The plaintext is bounded by PENDING_KEY_TTL_MS, not
  // reveal-once (D3) — see readPendingApiKey/expirePendingApiKeys.
  approveServer(id: string, apiKey: string, apiKeyHash: string, now: string): ServerRow | undefined {
    const expiresAt = new Date(Date.parse(now) + PENDING_KEY_TTL_MS).toISOString();
    this.db
      .prepare(
        `UPDATE servers
         SET status = 'approved', api_key_hash = ?, pending_api_key = ?, pending_api_key_expires_at = ?, approved_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(apiKeyHash, apiKey, expiresAt, now, id);
    return this.getServer(id);
  }

  // D3: TTL-bounded, re-revealable-by-the-same-claim reveal (replaces
  // the old reveal-once semantics). Deliberately does NOT null the key
  // on a successful read — that was Finding 4/the original lost-response
  // bug: if the agent's HTTP response was lost after the server already
  // cleared the key, the agent could never retrieve it again short of an
  // admin reissue. Now a same-claim retry within the TTL window gets the
  // same key again; only the TTL sweep (expirePendingApiKeys) or a fresh
  // admin action ever clears it. The caller (routes/enroll.ts) is
  // responsible for verifying the enrollment claim BEFORE calling this —
  // this method only enforces the TTL, not authorization.
  readPendingApiKey(id: string, nowIso: string): string | undefined {
    const server = this.getServer(id);
    if (!server?.pending_api_key || !server.pending_api_key_expires_at) {
      return undefined;
    }
    if (server.pending_api_key_expires_at <= nowIso) {
      return undefined;
    }
    return server.pending_api_key;
  }

  // D5: sweep housekeeping for any pending_api_key past its reveal
  // window, independent of whether it was ever read. Complements the
  // check-on-read gate in readPendingApiKey (which is what actually
  // enforces correctness even between sweep runs) by making sure the
  // plaintext column itself doesn't linger in the DB file past its TTL.
  expirePendingApiKeys(nowIso: string): number {
    const result = this.db
      .prepare(
        `UPDATE servers
         SET pending_api_key = NULL, pending_api_key_expires_at = NULL
         WHERE pending_api_key IS NOT NULL AND pending_api_key_expires_at <= ?`,
      )
      .run(nowIso);
    return result.changes;
  }

  findApprovedServerByApiKeyHash(hash: string): ServerRow | undefined {
    return this.db
      .prepare("SELECT * FROM servers WHERE api_key_hash = ? AND status = 'approved'")
      .get(hash) as ServerRow | undefined;
  }

  // D4: admin-initiated revoke. Valid from 'pending' (reject an
  // enrollment outright) or 'approved' (shut off an active agent) — not
  // from 'revoked' (no-op, the caller should treat that as 409). Clears
  // api_key_hash so a revoked key can never authenticate again even if
  // status were somehow reverted without going through reissueApiKey,
  // and clears the pending reveal state / enrollment claim too, since
  // none of them should remain usable against a revoked server.
  revokeServer(id: string, now: string): { changed: boolean; server: ServerRow | undefined } {
    const result = this.db
      .prepare(
        `UPDATE servers
         SET status = 'revoked', api_key_hash = NULL, pending_api_key = NULL,
             pending_api_key_expires_at = NULL, enrollment_claim_hash = NULL
         WHERE id = ? AND status IN ('pending', 'approved')`,
      )
      .run(id);
    return { changed: result.changes > 0, server: this.getServer(id) };
  }

  // D4: admin-initiated reissue — rotates the API key for an 'approved'
  // server (compromised/lost key) or performs a controlled un-revoke of
  // a 'revoked' one (never automatic; only reachable through this
  // admin-only route). The new key is returned directly in the admin
  // response by the caller (routes/admin.ts) rather than through the
  // claim/poll reveal mechanism — this is an authenticated admin action,
  // not agent self-service, so there is no separate party that needs to
  // "poll" for it.
  reissueApiKey(id: string, apiKey: string, apiKeyHash: string, now: string): { changed: boolean; server: ServerRow | undefined } {
    const result = this.db
      .prepare(
        `UPDATE servers
         SET status = 'approved', api_key_hash = ?, pending_api_key = NULL,
             pending_api_key_expires_at = NULL, approved_at = ?
         WHERE id = ? AND status IN ('approved', 'revoked')`,
      )
      .run(apiKeyHash, now, id);
    return { changed: result.changes > 0, server: this.getServer(id) };
  }

  // ===== D4: admin action audit trail =====

  recordAdminAction(input: {
    action: AdminActionType;
    serverId: string;
    adminUserId: string;
    reason?: string;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO admin_actions (action, server_id, admin_user_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.action, input.serverId, input.adminUserId, input.reason ?? null, input.now);
  }

  listAdminActions(serverId: string, limit = 50): AdminActionRow[] {
    return this.db
      .prepare('SELECT * FROM admin_actions WHERE server_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(serverId, limit) as AdminActionRow[];
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

  // E5: idempotent when `eventId` is supplied — a retried POST for the
  // same (serverId, eventId) hits the partial unique index added in
  // migration 7 and is silently ignored (ON CONFLICT ... DO NOTHING)
  // rather than duplicated; the caller (routes/events.ts) still returns
  // 202 either way; it has no way to distinguish "inserted" from
  // "already had this one" and doesn't need to. `occurredAt` is optional
  // (E7) — older agents/events without it leave the column NULL.
  insertEvent(input: {
    serverId: string;
    category: EventCategory | 'heartbeat';
    severity: Severity;
    payload: EventPayload | Record<string, never>;
    now: string;
    eventId?: string;
    occurredAt?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO events (server_id, category, severity, payload, created_at, event_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (server_id, event_id) WHERE event_id IS NOT NULL DO NOTHING`,
      )
      .run(
        input.serverId,
        input.category,
        input.severity,
        JSON.stringify(input.payload),
        input.now,
        input.eventId ?? null,
        input.occurredAt ?? null,
      );
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
  //
  // D1/D2 (Wave 2 hardening): ordered by COALESCE(occurred_at, created_at)
  // DESC, not created_at DESC alone. Once a durable agent-side outbox can
  // deliver events late/out of order after an outage, "received last"
  // (created_at) is no longer the same thing as "happened last"
  // (occurred_at) — an old ERROR delivered late after a network partition
  // must not clobber a newer SUCCESS that already arrived. created_at
  // DESC, id DESC remains as the explicit tie-breaker for events that
  // share an occurred_at (or lack one entirely and fall back to
  // created_at for both the primary and tie-break key — a harmless
  // no-op comparison in that case).
  //
  // Index decision: deliberately NOT adding a new index for this COALESCE
  // ordering. idx_events_server_category_created (server_id, category,
  // created_at DESC, id DESC), added in Wave 1, cannot satisfy an
  // expression-based ORDER BY, so this subquery now does a small in-memory
  // sort per (server_id, category) group instead of a pure index range
  // seek. At this project's actual scale — dozens of servers, a handful
  // of categories each, 90-day retention keeping the events table small,
  // and this query running on dashboard polls rather than a hot request
  // path — that sort is cheap enough that a SQLite expression index (which
  // would need to duplicate occurred_at/created_at into an indexed
  // computed column, a bigger schema change than this hardening pass
  // warrants) is not justified. Revisit if event volume or poll frequency
  // grow by an order of magnitude.
  listLatestEventPerCategoryForAllServers(): EventRow[] {
    return this.db
      .prepare(
        `SELECT e.* FROM events e
         WHERE e.id = (
           SELECT e2.id FROM events e2
           WHERE e2.server_id = e.server_id AND e2.category = e.category
           ORDER BY COALESCE(e2.occurred_at, e2.created_at) DESC, e2.created_at DESC, e2.id DESC
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
           ORDER BY COALESCE(e2.occurred_at, e2.created_at) DESC, e2.created_at DESC, e2.id DESC
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
