import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from './app.js';
import type { AppConfig } from './config.js';
import { hashPassword } from './crypto.js';
import { openDb } from './db.js';
import { OperationsRepository, type UserRow } from './repository.js';
import type { UserRole } from './schemas.js';

export function createTestUser(
  repository: OperationsRepository,
  username: string,
  password: string,
  role: UserRole = 'admin',
): UserRow {
  return repository.createUser({
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
    role,
    now: new Date().toISOString(),
  });
}

export function buildTestApp(overrides: Partial<AppConfig> = {}): { app: Express; repository: OperationsRepository } {
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
    ...overrides,
  };
  const repository = new OperationsRepository(openDb(config.dbPath));
  return { app: createApp(repository, config), repository };
}
