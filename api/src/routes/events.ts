import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import type { OperationsRepository } from '../repository.js';
import { EventRequest } from '../schemas.js';

// Grilling Q18: Operations receives every event (SUCCESS included),
// independent of the agent's Discord NotificationMode — that filtering
// stays entirely on the BRAVO.Notifications side.
export function createEventsRouter(repository: OperationsRepository): Router {
  const router = Router();

  // Per-route, not router.use() — see admin.ts for why a blanket
  // path-less middleware on a router sharing '/api/v1' with sibling
  // routers is unsafe.
  router.post('/events', requireApiKey(repository), (req, res) => {
    const parsed = EventRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }
    const now = new Date().toISOString();
    const server = req.operationsServer!;
    repository.insertEvent({
      serverId: server.id,
      category: parsed.data.category,
      severity: parsed.data.severity,
      payload: parsed.data.payload,
      now,
      eventId: parsed.data.eventId,
      occurredAt: parsed.data.occurredAt,
    });
    repository.touchLastSeen(server.id, now);
    res.status(202).json({ status: 'accepted' });
  });

  return router;
}
