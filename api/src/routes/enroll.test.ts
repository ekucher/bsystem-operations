import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, createTestUser } from '../testUtils.js';
import type { OperationsRepository } from '../repository.js';
import type { Express } from 'express';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';

// Etap 3 replaced the interim X-Admin-Key with local-account sessions
// (see auth.ts) — approve now requires a logged-in 'admin' user.
async function loginAsAdmin(app: Express, repository: OperationsRepository): Promise<request.SuperAgentTest> {
  await createTestUser(repository, 'admin', 'test-password', 'admin');
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ username: 'admin', password: 'test-password' });
  return agent;
}

function enrollBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    serverId: SERVER_ID,
    institutionCode: '01234567',
    productType: 'LIMS',
    hostname: 'HOUSE-LIMS-01',
    ...overrides,
  };
}

// D2: bootstrap secret now travels only via the X-Bootstrap-Secret
// header, for both POST /enroll and GET /enroll/:serverId.
function enroll(app: Express, secret = 'test-bootstrap-secret', body: Record<string, unknown> = enrollBody()) {
  return request(app).post('/api/v1/enroll').set('X-Bootstrap-Secret', secret).send(body);
}

function poll(app: Express, serverId: string, claim: string | undefined, secret = 'test-bootstrap-secret') {
  const req = request(app).get(`/api/v1/enroll/${serverId}`).set('X-Bootstrap-Secret', secret);
  if (claim !== undefined) {
    req.set('X-Enrollment-Claim', claim);
  }
  return req;
}

describe('enrollment flow', () => {
  it('rejects an enroll request with the wrong bootstrap secret', async () => {
    const { app } = buildTestApp();
    const res = await enroll(app, 'wrong');
    expect(res.status).toBe(401);
  });

  it('rejects malformed enroll payloads (invalid serverId)', async () => {
    const { app } = buildTestApp();
    const res = await enroll(app, 'test-bootstrap-secret', enrollBody({ serverId: 'not-a-guid' }));
    expect(res.status).toBe(400);
  });

  // D2: a bootstrapSecret field in the JSON body is no longer the
  // accepted transport — it's simply ignored/absent from the schema,
  // and only the header is checked.
  it('rejects a POST /enroll with the secret in the body but not the header', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/api/v1/enroll')
      .send({ ...enrollBody(), bootstrapSecret: 'test-bootstrap-secret' });
    expect(res.status).toBe(401);
  });

  it('goes pending -> approved -> reveals the API key, re-revealable within the TTL window (D3)', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);

    const enrollRes = await enroll(app);
    expect(enrollRes.status).toBe(202);
    expect(enrollRes.body.status).toBe('pending');
    const claimToken = enrollRes.body.claimToken as string;
    expect(typeof claimToken).toBe('string');
    expect(claimToken.length).toBeGreaterThan(0);

    const pollBeforeApproval = await poll(app, SERVER_ID, claimToken);
    expect(pollBeforeApproval.body).toEqual({ status: 'pending' });

    const approveRes = await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body).toEqual({ status: 'approved' });

    const firstPoll = await poll(app, SERVER_ID, claimToken);
    expect(firstPoll.body.status).toBe('approved');
    expect(typeof firstPoll.body.apiKey).toBe('string');
    expect(firstPoll.body.apiKey.length).toBeGreaterThan(0);

    // D3: unlike the old reveal-once behavior, a second poll with the
    // SAME claim within the TTL window still returns the key — this is
    // the "lost first response" recovery path.
    const secondPoll = await poll(app, SERVER_ID, claimToken);
    expect(secondPoll.body.apiKey).toBe(firstPoll.body.apiKey);
  });

  // D1/Finding 2: the bootstrap secret alone (no claim) must not be
  // enough to pull an arbitrary enrollment's key, even though it's
  // visible fleet-wide and server GUIDs are visible via admin/servers.
  it('rejects a poll with the correct bootstrap secret but no/wrong enrollment claim', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await enroll(app);
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    const noClaim = await poll(app, SERVER_ID, undefined);
    expect(noClaim.status).toBe(404);

    const wrongClaim = await poll(app, SERVER_ID, 'claim_totally-wrong');
    expect(wrongClaim.status).toBe(404);
  });

  // D7: an unknown id and a wrong-claim request against a real id must
  // be indistinguishable.
  it('returns the same 404 shape for an unknown server id and a wrong claim on a real one', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await enroll(app);
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    const unknown = await poll(app, '99999999-0000-4000-8000-000000000000', 'claim_whatever');
    const wrongClaim = await poll(app, SERVER_ID, 'claim_whatever');
    expect(unknown.status).toBe(404);
    expect(wrongClaim.status).toBe(404);
    expect(unknown.body).toEqual(wrongClaim.body);
  });

  // D6: once a server is approved, a repeat POST /enroll must not
  // silently rewrite its identity fields, and must not succeed at all —
  // it now returns 409, not the old "202, no-op" idempotent response.
  it('rejects (409) re-enrolling an already-approved server rather than mutating or resetting it', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await enroll(app);
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    const reEnroll = await enroll(app, 'test-bootstrap-secret', enrollBody({ hostname: 'ATTACKER-RENAMED' }));
    expect(reEnroll.status).toBe(409);
    expect(reEnroll.body.status).toBe('approved');

    const server = repository.getServer(SERVER_ID);
    expect(server?.hostname).toBe('HOUSE-LIMS-01');
  });

  it('rejects (409) re-enrolling an already-revoked server', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await enroll(app);
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/revoke`);

    const reEnroll = await enroll(app);
    expect(reEnroll.status).toBe(409);
    expect(reEnroll.body.status).toBe('revoked');
  });

  // D6 (allowed case): while still pending, an agent correcting its own
  // enrollment IS allowed, and it rotates the claim (also serves as
  // D1/D3's "lost the first claim" recovery path).
  it('allows correcting hostname/institutionCode while still pending, and rotates the claim', async () => {
    const { app } = buildTestApp();
    const first = await enroll(app);
    const firstClaim = first.body.claimToken as string;

    const second = await enroll(app, 'test-bootstrap-secret', enrollBody({ hostname: 'HOUSE-LIMS-02' }));
    expect(second.status).toBe(202);
    const secondClaim = second.body.claimToken as string;
    expect(secondClaim).not.toBe(firstClaim);

    // The old claim no longer works...
    const pollOldClaim = await poll(app, SERVER_ID, firstClaim);
    expect(pollOldClaim.status).toBe(404);
    // ...but the new one does.
    const pollNewClaim = await poll(app, SERVER_ID, secondClaim);
    expect(pollNewClaim.status).toBe(200);
  });

  it('rejects approve attempts with no session', async () => {
    const { app } = buildTestApp();
    await enroll(app);

    const res = await request(app).post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(res.status).toBe(401);
  });

  it('rejects approve attempts from a viewer-role session', async () => {
    const { app, repository } = buildTestApp();
    await createTestUser(repository, 'viewer', 'test-password', 'viewer');
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ username: 'viewer', password: 'test-password' });
    await enroll(app);

    const res = await agent.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(res.status).toBe(403);
  });

  it('rejects approving a server that is already approved', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await enroll(app);
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    const res = await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(res.status).toBe(409);
  });
});

describe('D5: pending API key TTL', () => {
  it('an expired pending key can no longer be retrieved, even with the correct claim', async () => {
    const { app, repository, db } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const enrollRes = await enroll(app);
    const claimToken = enrollRes.body.claimToken as string;
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    // Simulate TTL expiry directly rather than sleeping 5 real minutes:
    // backdate expires_at, then let the sweep (also exercised directly)
    // and the check-on-read gate both confirm the key is gone.
    const beforeExpiry = repository.getServer(SERVER_ID);
    expect(beforeExpiry?.pending_api_key).toBeTruthy();
    const past = new Date(Date.now() - 1000).toISOString();
    db.prepare('UPDATE servers SET pending_api_key_expires_at = ? WHERE id = ?').run(past, SERVER_ID);

    const expiredPoll = await poll(app, SERVER_ID, claimToken);
    expect(expiredPoll.body).toEqual({ status: 'approved' });

    const swept = repository.expirePendingApiKeys(new Date().toISOString());
    expect(swept).toBe(1);
    const server = repository.getServer(SERVER_ID);
    expect(server?.pending_api_key).toBeNull();
    expect(server?.pending_api_key_expires_at).toBeNull();
  });
});
