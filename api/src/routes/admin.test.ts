import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, createTestUser } from '../testUtils.js';
import type { Express } from 'express';
import type { OperationsRepository } from '../repository.js';

async function loginAsAdmin(app: Express, repository: OperationsRepository) {
  await createTestUser(repository, 'admin', 'test-password', 'admin');
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ username: 'admin', password: 'test-password' });
  return agent;
}

async function loginAsViewer(app: Express, repository: OperationsRepository) {
  await createTestUser(repository, 'viewer', 'test-password', 'viewer');
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ username: 'viewer', password: 'test-password' });
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

// A1: a ServerRow carries api_key_hash/pending_api_key — internal-only
// columns that must never reach a JSON response. These assert the
// allow-list mapper (toPublicServer, see repository.ts) is actually
// wired into both server-reading admin endpoints, for both roles that
// can call them.
describe('server responses never leak credential columns', () => {
  const SENSITIVE_FIELD_PATTERN = /api_key_hash|pending_api_key|password_hash|session_token_hash/;

  it.each(['admin', 'viewer'] as const)('excludes hash columns from GET /admin/servers for role=%s', async (role) => {
    const { app, repository } = buildTestApp();
    const actor = role === 'admin' ? await loginAsAdmin(app, repository) : await loginAsViewer(app, repository);
    const admin = role === 'admin' ? actor : await loginAsAdmin(app, repository);
    const serverId = '66666666-6666-4666-8666-666666666666';
    await enrollApproveAndGetKey(app, admin, serverId);

    const overview = await actor.get('/api/v1/admin/servers');
    expect(overview.status).toBe(200);
    expect(JSON.stringify(overview.body)).not.toMatch(SENSITIVE_FIELD_PATTERN);
    const server = overview.body.servers.find((s: { id: string }) => s.id === serverId);
    // Positive assertion: legitimate fields still make it through the
    // allow-list, this isn't just an empty/broken object.
    expect(server).toMatchObject({ id: serverId, status: 'approved', hostname: `HOST-${serverId.slice(0, 8)}` });
  });

  it.each(['admin', 'viewer'] as const)('excludes hash columns from GET /admin/servers/:id for role=%s', async (role) => {
    const { app, repository } = buildTestApp();
    const actor = role === 'admin' ? await loginAsAdmin(app, repository) : await loginAsViewer(app, repository);
    const admin = role === 'admin' ? actor : await loginAsAdmin(app, repository);
    const serverId = '77777777-7777-4777-8777-777777777777';
    await enrollApproveAndGetKey(app, admin, serverId);

    const detail = await actor.get(`/api/v1/admin/servers/${serverId}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(SENSITIVE_FIELD_PATTERN);
    expect(detail.body.server).toMatchObject({ id: serverId, status: 'approved' });
  });

  it('excludes hash columns from the approve response', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const serverId = '88888888-8888-4888-8888-888888888888';
    await request(app)
      .post('/api/v1/enroll')
      .send({
        serverId,
        institutionCode: '01234567',
        productType: 'LIMS',
        hostname: 'HOST-approve',
        bootstrapSecret: 'test-bootstrap-secret',
      });
    const res = await admin.post(`/api/v1/admin/servers/${serverId}/approve`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(SENSITIVE_FIELD_PATTERN);
  });
});

// A6: Origin validation on the mutating (session-cookie-authed) approve
// route. A present-but-cross-origin request must be rejected even though
// the caller has a perfectly valid admin session — that's exactly the
// CSRF scenario (a forged form/fetch on another site riding the victim's
// cookie).
describe('CSRF Origin check on mutating admin routes', () => {
  it('rejects approve when Origin does not match the request Host', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const serverId = '99999999-9999-4999-8999-999999999999';
    await request(app)
      .post('/api/v1/enroll')
      .send({
        serverId,
        institutionCode: '01234567',
        productType: 'LIMS',
        hostname: 'HOST-csrf',
        bootstrapSecret: 'test-bootstrap-secret',
      });

    const res = await admin.post(`/api/v1/admin/servers/${serverId}/approve`).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('allows approve with no Origin header at all (non-browser clients)', async () => {
    const { app, repository } = buildTestApp();
    const admin = await loginAsAdmin(app, repository);
    const serverId = '10101010-1010-4101-8101-101010101010';
    await request(app)
      .post('/api/v1/enroll')
      .send({
        serverId,
        institutionCode: '01234567',
        productType: 'LIMS',
        hostname: 'HOST-no-origin',
        bootstrapSecret: 'test-bootstrap-secret',
      });

    const res = await admin.post(`/api/v1/admin/servers/${serverId}/approve`);
    expect(res.status).toBe(200);
  });
});
