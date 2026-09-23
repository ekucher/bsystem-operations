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
