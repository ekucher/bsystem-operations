import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { requireRole, requireSameOrigin, requireSession } from '../auth.js';
import { generateApiKey, hashSecret } from '../crypto.js';
import { groupLatestEventsByServer, isServerOnline, parseEventPayload } from '../serverStatus.js';
import { toPublicServer, type OperationsRepository } from '../repository.js';
import { ReissueRequest, RevokeRequest } from '../schemas.js';

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
    // D4: expose the audit trail minimally alongside the existing detail
    // payload rather than a dedicated endpoint — this is the only place
    // in admin.ts that already assembles a single server's full picture.
    const recentActions = repository.listAdminActions(server.id, 20).map((row) => ({
      action: row.action,
      adminUserId: row.admin_user_id,
      reason: row.reason,
      createdAt: row.created_at,
    }));
    res.status(200).json({
      server: {
        ...toPublicServer(server),
        isOnline: isServerOnline(server, new Date(), config.heartbeatExpectedIntervalMinutes, config.heartbeatMissedThreshold),
      },
      latestByCategory,
      events,
      recentActions,
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
    const now = new Date().toISOString();
    const approved = repository.approveServer(server.id, apiKey, hashSecret(apiKey), now);
    // Retrofit: approve didn't write an audit row before this hardening
    // pass (Agent A/pre-existing code) — every lifecycle-changing admin
    // action now does.
    repository.recordAdminAction({ action: 'approve', serverId: server.id, adminUserId: req.authUser!.id, now });
    res.status(200).json({ status: approved?.status });
  });

  // D4: reject an enrollment ('pending' -> 'revoked') or shut off an
  // active agent ('approved' -> 'revoked'). Already-'revoked' is 409,
  // not a no-op — revoking is a deliberate, auditable action and calling
  // it twice on the same server is almost certainly a caller mistake
  // worth surfacing rather than silently swallowing.
  router.post('/admin/servers/:serverId/revoke', adminOnly, requireSameOrigin(), (req, res) => {
    const server = repository.getServer(req.params.serverId);
    if (!server) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (server.status === 'revoked') {
      res.status(409).json({ error: 'already_revoked', status: server.status });
      return;
    }
    const parsed = RevokeRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }
    const now = new Date().toISOString();
    const result = repository.revokeServer(server.id, now);
    if (!result.changed || !result.server) {
      res.status(409).json({ error: 'not_revocable', status: server.status });
      return;
    }
    repository.recordAdminAction({
      action: 'revoke',
      serverId: server.id,
      adminUserId: req.authUser!.id,
      reason: parsed.data.reason,
      now,
    });
    res.status(200).json({ status: result.server.status });
  });

  // D4: rotate the key for an 'approved' server (compromised/lost key)
  // or perform a controlled, admin-initiated un-revoke of a 'revoked'
  // one. Not valid from 'pending' — that's what approve is for. The new
  // key is returned directly in this response (not via the claim/poll
  // mechanism D1/D3 built for agent self-service) since this is an
  // already-authenticated admin action, not the enrolling agent.
  router.post('/admin/servers/:serverId/reissue', adminOnly, requireSameOrigin(), (req, res) => {
    const server = repository.getServer(req.params.serverId);
    if (!server) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (server.status === 'pending') {
      res.status(409).json({ error: 'not_approved_or_revoked', status: server.status });
      return;
    }
    const parsed = ReissueRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }
    const apiKey = generateApiKey();
    const now = new Date().toISOString();
    const result = repository.reissueApiKey(server.id, apiKey, hashSecret(apiKey), now);
    if (!result.changed || !result.server) {
      res.status(409).json({ error: 'not_revocable', status: server.status });
      return;
    }
    repository.recordAdminAction({
      action: 'reissue',
      serverId: server.id,
      adminUserId: req.authUser!.id,
      reason: parsed.data.reason,
      now,
    });
    res.status(200).json({ status: result.server.status, apiKey });
  });

  return router;
}
