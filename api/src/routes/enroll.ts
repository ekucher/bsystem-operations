import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { hashSecret, hashesMatch, secretsMatch } from '../crypto.js';
import type { OperationsRepository, ServerRow } from '../repository.js';
import { EnrollRequest } from '../schemas.js';

// D1 (agent-enrollment hardening): true only when the caller both knows
// the fleet-wide bootstrap secret (checked by the caller before this)
// AND presents THIS server's own enrollment claim (from its last
// POST /enroll response). Compromise of the bootstrap secret alone
// (Finding 2 — every agent in the fleet holds it indefinitely, and
// server GUIDs are visible to any admin/viewer via GET /admin/servers)
// is no longer sufficient to pull an arbitrary other enrollment's key.
function claimMatches(server: ServerRow | undefined, claim: string | undefined): boolean {
  if (!server || !claim) {
    return false;
  }
  return hashesMatch(hashSecret(claim), server.enrollment_claim_hash);
}

export function createEnrollRouter(repository: OperationsRepository, config: AppConfig): Router {
  const router = Router();

  // Self-enrollment (grilling Q17/Q19): the agent generates its own GUID
  // and calls this unauthenticated-by-identity, secret-gated endpoint.
  // D2: the bootstrap secret travels only via X-Bootstrap-Secret now —
  // the same header GET /enroll/:serverId already used — instead of a
  // second, body-based transport for the same credential.
  router.post('/enroll', (req, res) => {
    if (!secretsMatch(req.header('X-Bootstrap-Secret'), config.bootstrapSecret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const parsed = EnrollRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }
    const result = repository.upsertPendingServer({
      id: parsed.data.serverId,
      institutionCode: parsed.data.institutionCode,
      productType: parsed.data.productType,
      hostname: parsed.data.hostname,
      now: new Date().toISOString(),
    });
    // D6: a repeat POST /enroll for an already-approved/revoked server
    // id is rejected outright rather than silently rewriting identity —
    // see repository.upsertPendingServer's doc comment for why this is
    // the chosen (safe-default) behavior over a claim-gated identity
    // update.
    if (result.outcome === 'locked') {
      res.status(409).json({ error: 'already_finalized', status: result.server.status });
      return;
    }
    // claimToken is returned exactly here, in plaintext, exactly once
    // per call — the caller (the enrolling agent) must hold onto it; a
    // lost response is recovered by re-POSTing (see the doc comment on
    // upsertPendingServer), which rotates and re-returns a usable claim
    // as long as the server is still 'pending'.
    res.status(202).json({ status: result.server.status, claimToken: result.claimToken });
  });

  // The agent polls this until an administrator approves it in
  // Operations UI. D3: the API key is retrievable (not reveal-once) for
  // as long as PENDING_KEY_TTL_MS hasn't elapsed since approve/reissue —
  // a same-claim retry recovers from one lost response. D1: both the
  // fleet bootstrap secret AND this server's own enrollment claim
  // (X-Enrollment-Claim) are required. D7: unknown id, a revoked
  // server, and a present-but-wrong/missing claim all deterministically
  // produce the exact same 404 — nothing here should let a caller
  // distinguish "wrong claim" from "never existed" from "revoked".
  router.get('/enroll/:serverId', (req, res) => {
    if (!secretsMatch(req.header('X-Bootstrap-Secret'), config.bootstrapSecret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const server = repository.getServer(req.params.serverId);
    const claim = req.header('X-Enrollment-Claim');
    if (!server || server.status === 'revoked' || !claimMatches(server, claim)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (server.status !== 'approved') {
      res.status(200).json({ status: server.status });
      return;
    }
    const apiKey = repository.readPendingApiKey(server.id, new Date().toISOString());
    res.status(200).json({ status: server.status, apiKey });
  });

  return router;
}
