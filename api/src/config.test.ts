import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPERATIONS_BOOTSTRAP_SECRET: 'a-real-secret',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig — valid input', () => {
  it('applies documented defaults when nothing is set', () => {
    const config = loadConfig(baseEnv());
    expect(config).toMatchObject({
      port: 8080,
      dbPath: './data/operations.sqlite3',
      eventRetentionDays: 90,
      heartbeatMissedThreshold: 2,
      sessionTtlHours: 24,
      cookieSecure: true,
      heartbeatExpectedIntervalMinutes: 60,
      offlineCheckIntervalMinutes: 5,
      gitSha: 'unknown',
    });
    expect(config.bootstrapSecret).toBe('a-real-secret');
    expect(config.discordAlertsWebhookUrl).toBeUndefined();
  });

  it('passes explicit valid values through unchanged', () => {
    const config = loadConfig(
      baseEnv({
        PORT: '9090',
        EVENT_RETENTION_DAYS: '30',
        HEARTBEAT_MISSED_THRESHOLD: '3',
        COOKIE_SECURE: 'false',
        DISCORD_ALERTS_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
        GIT_SHA: 'cafebabe',
      }),
    );
    expect(config.port).toBe(9090);
    expect(config.eventRetentionDays).toBe(30);
    expect(config.heartbeatMissedThreshold).toBe(3);
    expect(config.cookieSecure).toBe(false);
    expect(config.discordAlertsWebhookUrl).toBe('https://discord.com/api/webhooks/123/abc');
    expect(config.gitSha).toBe('cafebabe');
  });

  it('leaves bootstrapSecret undefined when unset (fail-closed enrollment)', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.bootstrapSecret).toBeUndefined();
  });
});

describe('loadConfig — invalid input fails loudly', () => {
  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig(baseEnv({ PORT: 'not-a-number' }))).toThrow(ConfigError);
    try {
      loadConfig(baseEnv({ PORT: 'not-a-number' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('PORT');
    }
  });

  it('rejects negative EVENT_RETENTION_DAYS', () => {
    expect(() => loadConfig(baseEnv({ EVENT_RETENTION_DAYS: '-5' }))).toThrow(/EVENT_RETENTION_DAYS/);
  });

  it('rejects a zero HEARTBEAT_MISSED_THRESHOLD', () => {
    expect(() => loadConfig(baseEnv({ HEARTBEAT_MISSED_THRESHOLD: '0' }))).toThrow(ConfigError);
  });

  it('rejects a malformed DISCORD_ALERTS_WEBHOOK_URL', () => {
    expect(() => loadConfig(baseEnv({ DISCORD_ALERTS_WEBHOOK_URL: 'not a url' }))).toThrow(
      /DISCORD_ALERTS_WEBHOOK_URL/,
    );
  });

  it('rejects a non-integer SESSION_TTL_HOURS', () => {
    expect(() => loadConfig(baseEnv({ SESSION_TTL_HOURS: '12.5' }))).toThrow(ConfigError);
  });

  it('rejects a COOKIE_SECURE value that is neither "true" nor "false"', () => {
    expect(() => loadConfig(baseEnv({ COOKIE_SECURE: 'flase' }))).toThrow(ConfigError);
  });

  it('reports every invalid field in one error, not just the first', () => {
    try {
      loadConfig(baseEnv({ PORT: 'abc', EVENT_RETENTION_DAYS: '-1' }));
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('EVENT_RETENTION_DAYS');
    }
  });
});
