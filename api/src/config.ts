// Centralised env-var reading so every consumer sees the same defaults —
// scattering `process.env.X` across route files makes it easy for two
// places to disagree on a default.
export interface AppConfig {
  port: number;
  dbPath: string;
  adminApiKey: string | undefined;
  bootstrapSecret: string | undefined;
  eventRetentionDays: number;
  heartbeatMissedThreshold: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8080),
    dbPath: env.DB_PATH ?? './data/operations.sqlite3',
    // Undefined (not a weak default) on purpose: admin/enrollment routes
    // fail closed when these are unset, rather than accepting an empty
    // string as a valid secret.
    adminApiKey: env.ADMIN_API_KEY,
    bootstrapSecret: env.OPERATIONS_BOOTSTRAP_SECRET,
    eventRetentionDays: Number(env.EVENT_RETENTION_DAYS ?? 90),
    // Matches the BRAVO-Toolkit agent side decision (Q20): 2 consecutive
    // missed heartbeats mark a server offline.
    heartbeatMissedThreshold: Number(env.HEARTBEAT_MISSED_THRESHOLD ?? 2),
  };
}
