import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from './app.js';
import type { AppConfig } from './config.js';
import { hashPassword } from './crypto.js';
import { openDb, type Db } from './db.js';
import { OperationsRepository, type UserRow } from './repository.js';
import type { UserRole } from './schemas.js';

export async function createTestUser(
  repository: OperationsRepository,
  username: string,
  password: string,
  role: UserRole = 'admin',
): Promise<UserRow> {
  return repository.createUser({
    id: randomUUID(),
    username,
    passwordHash: await hashPassword(password),
    role,
    now: new Date().toISOString(),
  });
}

export function buildTestApp(
  overrides: Partial<AppConfig> = {},
): { app: Express; repository: OperationsRepository; db: Db } {
  const config: AppConfig = {
    port: 0,
    dbPath: ':memory:',
    bootstrapSecret: 'test-bootstrap-secret',
    eventRetentionDays: 90,
    heartbeatMissedThreshold: 2,
    sessionTtlHours: 24,
    cookieSecure: false,
    heartbeatExpectedIntervalMinutes: 60,
    discordAlertsWebhookUrl: undefined,
    offlineCheckIntervalMinutes: 5,
    gitSha: 'test-sha',
    ...overrides,
  };
  const db = openDb(config.dbPath);
  const repository = new OperationsRepository(db);
  return { app: createApp(repository, config, db), repository, db };
}
