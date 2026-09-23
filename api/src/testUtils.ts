import type { Express } from 'express';
import { createApp } from './app.js';
import type { AppConfig } from './config.js';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';

export function buildTestApp(overrides: Partial<AppConfig> = {}): { app: Express; repository: OperationsRepository } {
  const config: AppConfig = {
    port: 0,
    dbPath: ':memory:',
    adminApiKey: 'test-admin-key',
    bootstrapSecret: 'test-bootstrap-secret',
    eventRetentionDays: 90,
    heartbeatMissedThreshold: 2,
    ...overrides,
  };
  const repository = new OperationsRepository(openDb(config.dbPath));
  return { app: createApp(repository, config), repository };
}
