import express, { type Express } from 'express';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import { createHealthRouter } from './health.js';
import type { OperationsRepository } from './repository.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createEnrollRouter } from './routes/enroll.js';
import { createEventsRouter } from './routes/events.js';
import { createHeartbeatRouter } from './routes/heartbeat.js';

// Separated from index.ts so tests can build an app against an in-memory
// repository without binding a port. `db` is passed alongside
// `repository` (rather than reaching into it) because OperationsRepository
// keeps its Db handle private — the health router's readiness check is
// the one place outside the repository that needs a raw handle to probe.
export function createApp(repository: OperationsRepository, config: AppConfig, db: Db): Express {
  const app = express();
  app.use(express.json());
  app.use(createHealthRouter(db, config));
  app.use('/api/v1', createAuthRouter(repository, config));
  app.use('/api/v1', createEnrollRouter(repository, config));
  app.use('/api/v1', createAdminRouter(repository, config));
  app.use('/api/v1', createEventsRouter(repository));
  app.use('/api/v1', createHeartbeatRouter(repository));
  return app;
}
