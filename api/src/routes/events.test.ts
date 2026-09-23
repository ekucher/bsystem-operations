import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../testUtils.js';
import type { Express } from 'express';

const SERVER_ID = '22222222-2222-4222-8222-222222222222';

async function enrollAndApprove(app: Express): Promise<string> {
  await request(app).post('/api/v1/enroll').send({
    serverId: SERVER_ID,
    institutionCode: '01234567',
    productType: 'VETOFFICE',
    hostname: 'HOUSE-VET-01',
    bootstrapSecret: 'test-bootstrap-secret',
  });
  await request(app).post(`/api/v1/admin/servers/${SERVER_ID}/approve`).set('X-Admin-Key', 'test-admin-key');
  const poll = await request(app)
    .get(`/api/v1/enroll/${SERVER_ID}`)
    .set('X-Bootstrap-Secret', 'test-bootstrap-secret');
  return poll.body.apiKey as string;
}

describe('events + heartbeat ingest', () => {
  let app: Express;
  let apiKey: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    apiKey = await enrollAndApprove(app);
  });

  it('rejects events without a valid API key', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .send({ category: 'backup', severity: 'SUCCESS', payload: { message: 'ok' } });
    expect(res.status).toBe(401);
  });

  it('rejects events with a revoked/unknown API key', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('X-Api-Key', 'bop_not-a-real-key')
      .send({ category: 'backup', severity: 'SUCCESS', payload: { message: 'ok' } });
    expect(res.status).toBe(401);
  });

  it('accepts a SUCCESS event even though it carries no problem to report', async () => {
    // Grilling Q18: Operations must receive SUCCESS events too, unlike
    // Discord which can be configured to errors_only.
    const res = await request(app)
      .post('/api/v1/events')
      .set('X-Api-Key', apiKey)
      .send({ category: 'health', severity: 'SUCCESS', payload: { message: 'усі служби працюють' } });
    expect(res.status).toBe(202);
  });

  it('accepts a health event carrying per-service running/stopped status', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('X-Api-Key', apiKey)
      .send({
        category: 'health',
        severity: 'CRITICAL',
        payload: {
          message: 'exchangAPI не запущена',
          services: [
            { name: 'BRAVO', status: 'running' },
            { name: 'exchangAPI', status: 'stopped' },
            { name: 'BRAVO-Web', status: 'unknown' },
          ],
        },
      });
    expect(res.status).toBe(202);

    const detail = await request(app)
      .get(`/api/v1/admin/servers/${SERVER_ID}`)
      .set('X-Admin-Key', 'test-admin-key');
    expect(detail.body.events).toHaveLength(1);
    expect(detail.body.events[0].category).toBe('health');
    expect(JSON.parse(detail.body.events[0].payload).services).toHaveLength(3);
  });

  it('rejects a malformed event payload (missing message)', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('X-Api-Key', apiKey)
      .send({ category: 'backup', severity: 'SUCCESS', payload: {} });
    expect(res.status).toBe(400);
  });

  it('records a heartbeat and updates last_heartbeat_at', async () => {
    const res = await request(app)
      .post('/api/v1/heartbeat')
      .set('X-Api-Key', apiKey)
      .send({ bravoVersion: '5.3.0' });
    expect(res.status).toBe(202);

    const detail = await request(app)
      .get(`/api/v1/admin/servers/${SERVER_ID}`)
      .set('X-Admin-Key', 'test-admin-key');
    expect(detail.body.server.last_heartbeat_at).not.toBeNull();
    expect(detail.body.server.bravo_version).toBe('5.3.0');
  });
});
