import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { secretsMatch } from '../crypto.js';
import type { OperationsRepository } from '../repository.js';
import { EnrollRequest } from '../schemas.js';

export function createEnrollRouter(repository: OperationsRepository, config: AppConfig): Router {
  const router = Router();

  // Self-enrollment (grilling Q17/Q19): the agent generates its own GUID
  // and calls this unauthenticated-by-identity, secret-gated endpoint.
  // Idempotent — a retried enrollment must not reset an already-approved
  // or revoked server back to pending.
  router.post('/enroll', (req, res) => {
    const parsed = EnrollRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }
    if (!secretsMatch(parsed.data.bootstrapSecret, config.bootstrapSecret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const server = repository.upsertPendingServer({
      id: parsed.data.serverId,
      institutionCode: parsed.data.institutionCode,
      productType: parsed.data.productType,
      hostname: parsed.data.hostname,
      now: new Date().toISOString(),
    });
    res.status(202).json({ status: server.status });
  });

  // The agent polls this until an administrator approves it in Operations
  // UI. The API key is returned exactly once (reveal-once, see
  // OperationsRepository.consumePendingApiKey) — a missed response means
  // re-enrollment, not a re-fetch.
  router.get('/enroll/:serverId', (req, res) => {
    if (!secretsMatch(req.header('X-Bootstrap-Secret'), config.bootstrapSecret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const server = repository.getServer(req.params.serverId);
    if (!server) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (server.status !== 'approved') {
      res.status(200).json({ status: server.status });
      return;
    }
    const apiKey = repository.consumePendingApiKey(server.id);
    res.status(200).json({ status: server.status, apiKey });
  });

  return router;
}
