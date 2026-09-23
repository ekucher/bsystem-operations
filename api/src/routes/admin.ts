import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { requireAdmin } from '../auth.js';
import { generateApiKey, hashSecret } from '../crypto.js';
import type { OperationsRepository } from '../repository.js';

// Interim v1 read/admin surface behind the shared admin key (see auth.ts
// requireAdmin). Etap 3 replaces this auth model with per-user local
// accounts and an RBAC role; these routes and their data shape are what
// that UI will consume, so they are built now as part of the backend
// contract rather than deferred alongside the UI itself.
export function createAdminRouter(repository: OperationsRepository, config: AppConfig): Router {
  const router = Router();
  // Applied per-route rather than via a blanket router.use(): this router
  // is mounted at the same '/api/v1' prefix as the enroll/events/heartbeat
  // routers, and a path-less router.use() middleware runs for EVERY
  // request that reaches this router instance — including ones meant for
  // a sibling router's routes — not just the routes defined below it.
  const admin = requireAdmin(config);

  router.get('/admin/servers', admin, (_req, res) => {
    res.status(200).json({ servers: repository.listServers() });
  });

  router.get('/admin/servers/:serverId', admin, (req, res) => {
    const server = repository.getServer(req.params.serverId);
    if (!server) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const events = repository.listRecentEvents(server.id, 200);
    res.status(200).json({ server, events });
  });

  router.post('/admin/servers/:serverId/approve', admin, (req, res) => {
    const server = repository.getServer(req.params.serverId);
    if (!server) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (server.status !== 'pending') {
      res.status(409).json({ error: 'not_pending', status: server.status });
      return;
    }
    const apiKey = generateApiKey();
    const approved = repository.approveServer(server.id, apiKey, hashSecret(apiKey), new Date().toISOString());
    res.status(200).json({ status: approved?.status });
  });

  return router;
}
