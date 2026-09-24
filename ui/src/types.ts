export type ProductType = 'LIMS' | 'VETOFFICE';
export type ServerStatus = 'pending' | 'approved' | 'revoked';
export type EventCategory = 'backup' | 'maintenance' | 'health';
export type Severity = 'SUCCESS' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type ServiceRunState = 'running' | 'stopped' | 'unknown';
export type UserRole = 'admin' | 'viewer';

export interface ServiceStatusEntry {
  name: string;
  status: ServiceRunState;
}

// Опційна структура всередині EventPayload.details.stages — надсилається
// BRAVO.Archive (Write-BRAVOArchiveStep: OK/SKIPPED/WARNING/ERROR) і
// BRAVO.Maintenance (BRAVOMaintenanceStepLog: OK/SKIPPED/WARN/FAIL) —
// два різні словники статусів, не уніфіковані на боці агента. Не є
// частиною EventRequest-схеми API (details лишається довільним record).
export interface EventStage {
  name: string;
  status: 'OK' | 'SKIPPED' | 'WARNING' | 'ERROR' | 'WARN' | 'FAIL';
  details?: string | null;
  durationMs?: number | null;
}

const EVENT_STAGE_STATUSES: readonly string[] = ['OK', 'SKIPPED', 'WARNING', 'ERROR', 'WARN', 'FAIL'];

// Runtime guard for `details.stages` entries: this JSON blob comes from a
// third-party agent (BRAVO.Archive/Maintenance) over HTTP, not from a
// schema the UI controls, so a malformed or future-shaped entry (missing
// `name`/`status`, non-object array elements, unexpected status strings)
// must be filtered out here rather than crash the page downstream.
export function isEventStage(value: unknown): value is EventStage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || typeof candidate.status !== 'string') {
    return false;
  }
  if (!EVENT_STAGE_STATUSES.includes(candidate.status)) {
    return false;
  }
  if (candidate.details !== undefined && candidate.details !== null && typeof candidate.details !== 'string') {
    return false;
  }
  if (candidate.durationMs !== undefined && candidate.durationMs !== null && typeof candidate.durationMs !== 'number') {
    return false;
  }
  return true;
}

export interface EventPayload {
  message: string;
  component?: string;
  services?: ServiceStatusEntry[];
  details?: Record<string, unknown>;
}

export interface LatestCategoryStatus {
  severity: Severity;
  createdAt: string;
  payload: EventPayload;
}

export interface ServerSummary {
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
  isOnline: boolean;
  latestByCategory: Partial<Record<EventCategory, LatestCategoryStatus>>;
}

export interface EventRow {
  id: number;
  server_id: string;
  category: EventCategory | 'heartbeat';
  severity: Severity;
  // Raw JSON string as stored — components parse it with JSON.parse
  // rather than the API pre-parsing every row in the (potentially
  // 1000-entry) timeline.
  payload: string;
  created_at: string;
}

export interface ServerDetail {
  server: ServerSummary;
  latestByCategory: Partial<Record<EventCategory, LatestCategoryStatus>>;
  events: EventRow[];
}

export interface AuthUser {
  username: string;
  role: UserRole;
}
