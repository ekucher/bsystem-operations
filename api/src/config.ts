// Centralised env-var reading so every consumer sees the same defaults —
// scattering `process.env.X` across route files makes it easy for two
// places to disagree on a default.
export interface AppConfig {
  port: number;
  dbPath: string;
  bootstrapSecret: string | undefined;
  eventRetentionDays: number;
  heartbeatMissedThreshold: number;
  // Etap 3 (local accounts):
  sessionTtlHours: number;
  // Secure-only cookies by default (fail safe); local dev over plain
  // http sets COOKIE_SECURE=false explicitly to opt out.
  cookieSecure: boolean;
  // BRAVO.config's operationsReportingSettings.HeartbeatIntervalMinutes
  // default — the API has no per-server interval (agents don't report
  // it), so this is a fleet-wide assumption used only to flag a server
  // "offline" in the overview/detail UI. Etap 4's Discord alerting reuses
  // the same threshold.
  heartbeatExpectedIntervalMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8080),
    dbPath: env.DB_PATH ?? './data/operations.sqlite3',
    // Undefined (not a weak default) on purpose: enrollment routes fail
    // closed when this is unset, rather than accepting an empty string as
    // a valid secret.
    bootstrapSecret: env.OPERATIONS_BOOTSTRAP_SECRET,
    eventRetentionDays: Number(env.EVENT_RETENTION_DAYS ?? 90),
    // Matches the BRAVO-Toolkit agent side decision (Q20): 2 consecutive
    // missed heartbeats mark a server offline.
    heartbeatMissedThreshold: Number(env.HEARTBEAT_MISSED_THRESHOLD ?? 2),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24),
    cookieSecure: env.COOKIE_SECURE !== 'false',
    heartbeatExpectedIntervalMinutes: Number(env.HEARTBEAT_EXPECTED_INTERVAL_MINUTES ?? 60),
  };
}
