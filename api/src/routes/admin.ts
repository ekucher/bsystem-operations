import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { requireRole, requireSameOrigin, requireSession } from '../auth.js';
import { generateApiKey, hashSecret } from '../crypto.js';
import { groupLatestEventsByServer, isServerOnline, parseEventPayload } from '../serverStatus.js';
import { toPublicServer, type OperationsRepository } from '../repository.js';

// Etap 3: local accounts + RBAC (see auth.ts) replace the interim v1
// shared admin key. Viewer role gets read access; approve stays
// admin-only.
export function createAdminRouter(repository: OperationsRepository, config: AppConfig): Router {
  const router = Router();
  // Applied per-route rather than via a blanket router.use(): this router
  // is mounted at the same '/api/v1' prefix as the enroll/events/heartbeat
  // routers, and a path-less router.use() middleware runs for EVERY
  // request that reaches this router instance — including ones meant for
  // a sibling router's routes — not just the routes defined below it.
  const authed = requireSession(repository);
  const adminOnly = requireRole(repository, 'admin');

  router.get('/admin/servers', authed, (_req, res) => {
    const servers = repository.listServers();
    const latestByServer = groupLatestEventsByServer(repository.listLatestEventPerCategoryForAllServers());
    const now = new Date();
    const enriched = servers.map((server) => ({
      ...toPublicServer(server),
      isOnline: isServerOnline(server, now, config.heartbeatExpectedIntervalMinutes, config.heartbeatMissedThreshold),
      latestByCategory: latestByServer.get(server.id) ?? {},
    }));
    res.status(200).json({
      servers: enriched,
      heartbeatExpectedIntervalMinutes: config.heartbeatExpectedIntervalMinutes,
      heartbeatMissedThreshold: config.heartbeatMissedThreshold,
    });
  });

  router.get('/admin/servers/:serverId', authed, (req, res) => {
    const server = repository.getServer(req.params.serverId);
    if (!server) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const events = repository.listRecentEvents(server.id, 1000);
    const latestByCategoryRows = repository.listLatestEventPerCategory(server.id);
    const latestByCategory: Record<string, unknown> = {};
    for (const row of latestByCategoryRows) {
      latestByCategory[row.category] = {
        severity: row.severity,
        createdAt: row.created_at,
        payload: parseEventPayload(row.payload),
      };
    }
    res.status(200).json({
      server: {
        ...toPublicServer(server),
        isOnline: isServerOnline(server, new Date(), config.heartbeatExpectedIntervalMinutes, config.heartbeatMissedThreshold),
      },
      latestByCategory,
      events,
    });
  });

  router.post('/admin/servers/:serverId/approve', adminOnly, requireSameOrigin(), (req, res) => {
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
