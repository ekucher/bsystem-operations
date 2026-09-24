import express, { type Express, type NextFunction, type Request, type Response } from 'express';
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
  // Exactly one hop: in every deployment of this app (see
  // docker-compose.yml), the API container publishes no host port at
  // all and is reachable ONLY through the bundled nginx (`ui`) container
  // on the compose network — so there is exactly one trusted proxy
  // between any client and this process. `1` makes Express read
  // `X-Forwarded-For`'s rightmost entry (the one nginx itself set from
  // the real client's socket address, see proxy_set_header X-Forwarded-For
  // in ui/nginx.conf) into req.ip, and ignore anything a client tries to
  // prepend to that header. Leaving this unset would make req.ip always
  // resolve to nginx's own docker-internal address (every request looks
  // like it's from the same "client", making the per-IP login limiter in
  // auth.ts useless); setting it to `true` (trust any depth) would let a
  // client's own X-Forwarded-For value be used directly, trivially
  // spoofable to bypass that same limiter.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(createHealthRouter(db, config));
  app.use('/api/v1', createAuthRouter(repository, config));
  app.use('/api/v1', createEnrollRouter(repository, config));
  app.use('/api/v1', createAdminRouter(repository, config));
  app.use('/api/v1', createEventsRouter(repository));
  app.use('/api/v1', createHeartbeatRouter(repository));

  // Last-resort safety net (4-arg signature is how Express recognizes an
  // error handler): catches anything that reaches `next(err)`, notably
  // rejections forwarded by asyncHandler (see asyncHandler.ts) from any
  // async route handler. Without this, Express 4's default error handler
  // would still respond, but by echoing the error's message/stack back
  // to the client — logging the real error server-side and returning a
  // generic message here is the difference between an internal detail
  // leak and a safe, opaque failure.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error in request pipeline:', err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
