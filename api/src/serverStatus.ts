import type { EventRow, ServerRow } from './repository.js';

export interface LatestCategoryStatus {
  severity: string;
  createdAt: string;
  payload: unknown;
}

// events.payload is stored as a JSON TEXT column (see db.ts) — parsed
// once here rather than at every call site.
export function parseEventPayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    // A row that somehow failed to parse must not crash the whole
    // overview/detail response — surface it as opaque rather than 500.
    return { message: '(не вдалося розпарсити payload)' };
  }
}

// Overview needs "latest backup/maintenance/health status" for every
// server on one poll — groups the flat rows from
// listLatestEventPerCategoryForAllServers() by server_id so the route
// handler doesn't repeat this per server.
export function groupLatestEventsByServer(rows: EventRow[]): Map<string, Record<string, LatestCategoryStatus>> {
  const grouped = new Map<string, Record<string, LatestCategoryStatus>>();
  for (const row of rows) {
    if (!grouped.has(row.server_id)) {
      grouped.set(row.server_id, {});
    }
    grouped.get(row.server_id)![row.category] = {
      severity: row.severity,
      createdAt: row.created_at,
      payload: parseEventPayload(row.payload),
    };
  }
  return grouped;
}

// The API has no per-server heartbeat interval (agents don't report
// operationsReportingSettings.HeartbeatIntervalMinutes) — this uses a
// fleet-wide assumption (config.heartbeatExpectedIntervalMinutes) times
// the missed-heartbeat threshold (grilling Q20: 2 missed = offline).
//
// D5 (Wave 2 hardening): the reference point for "how long has it been
// since we last heard from this server" is `last_heartbeat_at ??
// approved_at`, not `last_heartbeat_at` alone. Without this fallback, a
// server that was JUST approved (last_heartbeat_at is still NULL — its
// agent hasn't sent its first heartbeat yet) had no reference point at
// all and was always treated as maximally overdue, so offlineMonitor.ts
// alerted it as "offline" almost immediately after approval — before the
// agent even had a chance to start reporting. Falling back to
// approved_at gives a freshly-approved server the SAME grace window
// (expectedIntervalMinutes * missedThreshold) to send its first
// heartbeat that an already-reporting server gets between heartbeats. A
// server that is neither approved nor ever heartbeated (still 'pending')
// has no reference point at all and is still never "online" — correct,
// since offlineMonitor.ts already skips non-approved servers entirely.
export function isServerOnline(
  server: ServerRow,
  now: Date,
  expectedIntervalMinutes: number,
  missedThreshold: number,
): boolean {
  const referenceIso = server.last_heartbeat_at ?? server.approved_at;
  if (!referenceIso) {
    return false;
  }
  const referenceMs = new Date(referenceIso).getTime();
  if (Number.isNaN(referenceMs)) {
    return false;
  }
  const thresholdMs = expectedIntervalMinutes * missedThreshold * 60_000;
  return now.getTime() - referenceMs <= thresholdMs;
}
