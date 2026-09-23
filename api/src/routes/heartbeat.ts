import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import type { OperationsRepository } from '../repository.js';
import { HeartbeatRequest } from '../schemas.js';

// Grilling Q6: event-driven pushes tell Operations "something happened";
// heartbeat tells it "the agent is still alive" even when nothing did.
// Etap 4 builds the offline-detection job that reads last_heartbeat_at —
// this route only records it.
export function createHeartbeatRouter(repository: OperationsRepository): Router {
  const router = Router();

  // Per-route, not router.use() — see admin.ts for why a blanket
  // path-less middleware on a router sharing '/api/v1' with sibling
  // routers is unsafe.
  router.post('/heartbeat', requireApiKey(repository), (req, res) => {
    const parsed = HeartbeatRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }
    const now = new Date().toISOString();
    const server = req.operationsServer!;
    repository.touchHeartbeat(server.id, now, parsed.data.bravoVersion);
    res.status(202).json({ status: 'accepted' });
  });

  return router;
}
