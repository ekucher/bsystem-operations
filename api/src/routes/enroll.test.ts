import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../testUtils.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';

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
    const { app } = buildTestApp();

    const enrollRes = await request(app).post('/api/v1/enroll').send(enrollBody());
    expect(enrollRes.status).toBe(202);
    expect(enrollRes.body).toEqual({ status: 'pending' });

    const pollBeforeApproval = await request(app)
      .get(`/api/v1/enroll/${SERVER_ID}`)
      .set('X-Bootstrap-Secret', 'test-bootstrap-secret');
    expect(pollBeforeApproval.body).toEqual({ status: 'pending' });

    const approveRes = await request(app)
      .post(`/api/v1/admin/servers/${SERVER_ID}/approve`)
      .set('X-Admin-Key', 'test-admin-key');
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
    const { app } = buildTestApp();
    await request(app).post('/api/v1/enroll').send(enrollBody());
    await request(app).post(`/api/v1/admin/servers/${SERVER_ID}/approve`).set('X-Admin-Key', 'test-admin-key');

    const reEnroll = await request(app).post('/api/v1/enroll').send(enrollBody());
    expect(reEnroll.body).toEqual({ status: 'approved' });
  });

  it('rejects approve attempts with the wrong admin key', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/enroll').send(enrollBody());

    const res = await request(app)
      .post(`/api/v1/admin/servers/${SERVER_ID}/approve`)
      .set('X-Admin-Key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('fails closed when the admin key is not configured at all', async () => {
    const { app } = buildTestApp({ adminApiKey: undefined });
    const res = await request(app)
      .post(`/api/v1/admin/servers/${SERVER_ID}/approve`)
      .set('X-Admin-Key', 'anything');
    expect(res.status).toBe(503);
  });

  it('rejects approving a server that is already approved', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/enroll').send(enrollBody());
    await request(app).post(`/api/v1/admin/servers/${SERVER_ID}/approve`).set('X-Admin-Key', 'test-admin-key');

    const res = await request(app)
      .post(`/api/v1/admin/servers/${SERVER_ID}/approve`)
      .set('X-Admin-Key', 'test-admin-key');
    expect(res.status).toBe(409);
  });
});
