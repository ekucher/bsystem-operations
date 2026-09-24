// Centralised env-var reading so every consumer sees the same defaults —
// scattering `process.env.X` across route files makes it easy for two
// places to disagree on a default.
//
// Every raw value is validated with zod before it becomes part of
// AppConfig: a typo'd PORT or a negative retention day count must fail
// loudly at startup (see loadConfig()/index.ts), not silently become NaN
// or a nonsensical negative duration three layers deep in some route.
import { z } from 'zod';

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
  // Etap 4 (grilling: offline-детекція -> наявний Discord alerts-канал,
  // не нова інфраструктура сповіщень). Undefined = alerting disabled
  // (fail-safe no-op, not a crash) — same "explicit opt-in" posture as
  // bootstrapSecret.
  discordAlertsWebhookUrl: string | undefined;
  offlineCheckIntervalMinutes: number;
  // Build/deploy metadata (git revision), surfaced by GET /health for
  // "which build is actually running" debugging. Baked into the image at
  // build time (see api/Dockerfile's GIT_SHA build arg) — falls back to
  // "unknown" when nothing supplied it, which is a legitimate value (e.g.
  // local `npm run dev`), not a config error.
  gitSha: string;
}

/** Thrown by loadConfig() when the environment fails validation. Message
 * is already human-readable (one line per bad field) — callers should
 * print `error.message` directly rather than a stack trace. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// `defaultValue` is applied when the var is unset/empty, then the result
// (default or supplied string) is run through the same numeric checks —
// so a bad *default* would fail loudly too, not just bad user input.
function positiveInt(defaultValue: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? defaultValue : Number(trimmed);
  }, z.number().finite('must be a finite number').int('must be a whole number').positive('must be greater than 0'));
}

function optionalNonEmptyString() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1, 'must not be empty').optional(),
  );
}

function optionalUrl() {
  return z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().url('must be a valid URL').optional(),
  );
}

// Stricter than a loose truthy check on purpose: an unset/empty value
// falls back to `defaultValue`, but a *set* value that is neither "true"
// nor "false" (e.g. a typo like "flase") is now a startup error instead
// of silently resolving to whichever side happens to be safe.
function booleanFlag(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue ? 'true' : 'false';
    }
    return value;
  }, z.enum(['true', 'false'], { message: 'must be "true" or "false"' }));
}

const envSchema = z.object({
  PORT: positiveInt(8080),
  DB_PATH: z.preprocess(
    (value) => (value === undefined || value === '' ? './data/operations.sqlite3' : value),
    z.string().min(1),
  ),
  // No default on purpose: enrollment routes (see routes/enroll.ts +
  // crypto.ts's secretsMatch) fail closed when this is undefined, rather
  // than accepting an empty string as a valid secret.
  OPERATIONS_BOOTSTRAP_SECRET: optionalNonEmptyString(),
  EVENT_RETENTION_DAYS: positiveInt(90),
  // Matches the BRAVO-Toolkit agent side decision (Q20): 2 consecutive
  // missed heartbeats mark a server offline.
  HEARTBEAT_MISSED_THRESHOLD: positiveInt(2),
  SESSION_TTL_HOURS: positiveInt(24),
  COOKIE_SECURE: booleanFlag(true),
  HEARTBEAT_EXPECTED_INTERVAL_MINUTES: positiveInt(60),
  DISCORD_ALERTS_WEBHOOK_URL: optionalUrl(),
  OFFLINE_CHECK_INTERVAL_MINUTES: positiveInt(5),
  GIT_SHA: z.preprocess((value) => (value === undefined || value === '' ? 'unknown' : value), z.string().min(1)),
});

type RawEnv = z.infer<typeof envSchema>;

// Single source of truth for "which env vars does this app actually
// read" — reused by the env/compose documentation-parity check
// (envDocsParity.test.ts) so that list doesn't have to be kept in sync
// by hand in two places.
export const ENV_VAR_NAMES = Object.keys(envSchema.shape) as Array<keyof RawEnv>;

function parseEnv(env: NodeJS.ProcessEnv): RawEnv {
  const raw: Record<string, string | undefined> = {};
  for (const key of ENV_VAR_NAMES) {
    raw[key] = env[key];
  }
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = parseEnv(env);
  return {
    port: parsed.PORT,
    dbPath: parsed.DB_PATH,
    bootstrapSecret: parsed.OPERATIONS_BOOTSTRAP_SECRET,
    eventRetentionDays: parsed.EVENT_RETENTION_DAYS,
    heartbeatMissedThreshold: parsed.HEARTBEAT_MISSED_THRESHOLD,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    cookieSecure: parsed.COOKIE_SECURE === 'true',
    heartbeatExpectedIntervalMinutes: parsed.HEARTBEAT_EXPECTED_INTERVAL_MINUTES,
    discordAlertsWebhookUrl: parsed.DISCORD_ALERTS_WEBHOOK_URL,
    offlineCheckIntervalMinutes: parsed.OFFLINE_CHECK_INTERVAL_MINUTES,
    gitSha: parsed.GIT_SHA,
  };
}
