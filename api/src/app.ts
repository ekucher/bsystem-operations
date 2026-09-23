import express, { type Express } from 'express';
import type { AppConfig } from './config.js';
import { healthRouter } from './health.js';
import type { OperationsRepository } from './repository.js';
import { createAdminRouter } from './routes/admin.js';
import { createEnrollRouter } from './routes/enroll.js';
import { createEventsRouter } from './routes/events.js';
import { createHeartbeatRouter } from './routes/heartbeat.js';

// Separated from index.ts so tests can build an app against an in-memory
// repository without binding a port.
export function createApp(repository: OperationsRepository, config: AppConfig): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  app.use('/api/v1', createEnrollRouter(repository, config));
  app.use('/api/v1', createAdminRouter(repository, config));
  app.use('/api/v1', createEventsRouter(repository));
  app.use('/api/v1', createHeartbeatRouter(repository));
  return app;
}
