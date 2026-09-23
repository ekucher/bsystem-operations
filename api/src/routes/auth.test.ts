import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, createTestUser } from '../testUtils.js';

describe('local accounts (Etap 3)', () => {
  it('rejects login with a wrong password', async () => {
    const { app, repository } = buildTestApp();
    createTestUser(repository, 'admin', 'correct-password', 'admin');

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects login for an unknown username with the same error as a wrong password', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'nobody', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_credentials' });
  });

  it('rejects malformed login payloads', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/auth/login').send({ username: '' });
    expect(res.status).toBe(400);
  });

  it('logs in, reads its own identity via /auth/me, then logs out and loses access', async () => {
    const { app, repository } = buildTestApp();
    createTestUser(repository, 'operator', 'test-password', 'viewer');
    const agent = request.agent(app);

    const login = await agent.post('/api/v1/auth/login').send({ username: 'operator', password: 'test-password' });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ username: 'operator', role: 'viewer' });
    expect(login.headers['set-cookie']?.[0]).toMatch(/^ops_session=/);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ username: 'operator', role: 'viewer' });

    const logout = await agent.post('/api/v1/auth/logout');
    expect(logout.status).toBe(204);

    const meAfterLogout = await agent.get('/api/v1/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects /auth/me with no session at all', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a forged/unknown session cookie', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', 'ops_session=not-a-real-token');
    expect(res.status).toBe(401);
  });
});
