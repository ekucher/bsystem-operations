import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, createTestUser } from '../testUtils.js';
import type { Express } from 'express';
import type { OperationsRepository } from '../repository.js';

async function loginAsAdmin(app: Express, repository: OperationsRepository) {
  createTestUser(repository, 'admin', 'test-password', 'admin');
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ username: 'admin', password: 'test-password' });
  return agent;
}

async function enrollApproveAndGetKey(app: Express, admin: request.SuperAgentTest, serverId: string): Promise<string> {
  await request(app)
    .post('/api/v1/enroll')
    .send({
      serverId,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: `HOST-${serverId.slice(0, 8)}`,
      bootstrapSecret: 'test-bootstrap-secret',
    });
  await admin.post(`/api/v1/admin/servers/${serverId}/approve`);
  const poll = await request(app)
    .get(`/api/v1/enroll/${serverId}`)
    .set('X-Bootstrap-Secret', 'test-bootstrap-secret');
  return poll.body.apiKey as string;
}

describe('admin overview enrichment', () => {
  it('rejects listing servers without a session', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/admin/servers');
    expect(res.status).toBe(401);
  });

  it('flags a server offline when it has never sent a heartbeat', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const serverId = '33333333-3333-4333-8333-333333333333';
    await enrollApproveAndGetKey(app, admin, serverId);

    const overview = await admin.get('/api/v1/admin/servers');
    expect(overview.status).toBe(200);
    const server = overview.body.servers.find((s: { id: string }) => s.id === serverId);
    expect(server.isOnline).toBe(false);
  });

  it('flags a server online right after a heartbeat and groups latest events by category', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const serverId = '44444444-4444-4444-8444-444444444444';
    const apiKey = await enrollApproveAndGetKey(app, admin, serverId);

    await request(app).post('/api/v1/heartbeat').set('X-Api-Key', apiKey).send({ bravoVersion: '5.3.0' });
    await request(app)
      .post('/api/v1/events')
      .set('X-Api-Key', apiKey)
      .send({ category: 'backup', severity: 'SUCCESS', payload: { message: 'архів OK' } });
    await request(app)
      .post('/api/v1/events')
      .set('X-Api-Key', apiKey)
      .send({ category: 'backup', severity: 'CRITICAL', payload: { message: 'диск заповнено' } });

    const overview = await admin.get('/api/v1/admin/servers');
    const server = overview.body.servers.find((s: { id: string }) => s.id === serverId);
    expect(server.isOnline).toBe(true);
    // Latest of the two backup events must win (CRITICAL, not the
    // earlier SUCCESS) — proves the "latest per category" query orders
    // correctly rather than picking an arbitrary row.
    expect(server.latestByCategory.backup.severity).toBe('CRITICAL');
    expect(server.latestByCategory.backup.payload.message).toBe('диск заповнено');
  });

  it('never marks a pending (unapproved) server online', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const serverId = '55555555-5555-4555-8555-555555555555';
    await request(app)
      .post('/api/v1/enroll')
      .send({
        serverId,
        institutionCode: '01234567',
        productType: 'LIMS',
        hostname: 'HOST-pending',
        bootstrapSecret: 'test-bootstrap-secret',
      });

    const overview = await admin.get('/api/v1/admin/servers');
    const server = overview.body.servers.find((s: { id: string }) => s.id === serverId);
    expect(server.status).toBe('pending');
    expect(server.isOnline).toBe(false);
  });
});
