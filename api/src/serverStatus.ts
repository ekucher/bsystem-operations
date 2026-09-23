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
// A server that has never sent a heartbeat (pending enrollment, or
// approved but not yet checked in) is never "online".
export function isServerOnline(
  server: ServerRow,
  now: Date,
  expectedIntervalMinutes: number,
  missedThreshold: number,
): boolean {
  if (!server.last_heartbeat_at) {
    return false;
  }
  const lastHeartbeatMs = new Date(server.last_heartbeat_at).getTime();
  if (Number.isNaN(lastHeartbeatMs)) {
    return false;
  }
  const thresholdMs = expectedIntervalMinutes * missedThreshold * 60_000;
  return now.getTime() - lastHeartbeatMs <= thresholdMs;
}
