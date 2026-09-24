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
    bootstrapSecret: 'test-bootstrap-secret',
    ...overrides,
  };
}

describe('enrollment flow', () => {
  it('rejects an enroll request with the wrong bootstrap secret', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/api/v1/enroll')
      .send(enrollBody({ bootstrapSecret: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('rejects malformed enroll payloads (invalid serverId)', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/api/v1/enroll')
      .send(enrollBody({ serverId: 'not-a-guid' }));
    expect(res.status).toBe(400);
  });

  it('goes pending -> approved -> reveals the API key exactly once', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);

    const enrollRes = await request(app).post('/api/v1/enroll').send(enrollBody());
    expect(enrollRes.status).toBe(202);
    expect(enrollRes.body).toEqual({ status: 'pending' });

    const pollBeforeApproval = await request(app)
      .get(`/api/v1/enroll/${SERVER_ID}`)
      .set('X-Bootstrap-Secret', 'test-bootstrap-secret');
    expect(pollBeforeApproval.body).toEqual({ status: 'pending' });

    const approveRes = await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body).toEqual({ status: 'approved' });

    const firstPoll = await request(app)
      .get(`/api/v1/enroll/${SERVER_ID}`)
      .set('X-Bootstrap-Secret', 'test-bootstrap-secret');
    expect(firstPoll.body.status).toBe('approved');
    expect(typeof firstPoll.body.apiKey).toBe('string');
    expect(firstPoll.body.apiKey.length).toBeGreaterThan(0);

    // Reveal-once: a second poll must not return the plaintext key again.
    const secondPoll = await request(app)
      .get(`/api/v1/enroll/${SERVER_ID}`)
      .set('X-Bootstrap-Secret', 'test-bootstrap-secret');
    expect(secondPoll.body).toEqual({ status: 'approved' });
  });

  it('re-enrolling an already-approved server does not reset it to pending', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await request(app).post('/api/v1/enroll').send(enrollBody());
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    const reEnroll = await request(app).post('/api/v1/enroll').send(enrollBody());
    expect(reEnroll.body).toEqual({ status: 'approved' });
  });

  it('rejects approve attempts with no session', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/enroll').send(enrollBody());

    const res = await request(app).post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(res.status).toBe(401);
  });

  it('rejects approve attempts from a viewer-role session', async () => {
    const { app, repository } = buildTestApp();
    await createTestUser(repository, 'viewer', 'test-password', 'viewer');
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ username: 'viewer', password: 'test-password' });
    await request(app).post('/api/v1/enroll').send(enrollBody());

    const res = await agent.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(res.status).toBe(403);
  });

  it('rejects approving a server that is already approved', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    await request(app).post('/api/v1/enroll').send(enrollBody());
    await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);

    const res = await admin.post(`/api/v1/admin/servers/${SERVER_ID}/approve`);
    expect(res.status).toBe(409);
  });
});
