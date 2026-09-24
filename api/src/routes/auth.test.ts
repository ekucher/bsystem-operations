import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '../auth.js';
import { generateSessionToken, hashSecret } from '../crypto.js';
import { buildTestApp, createTestUser } from '../testUtils.js';

describe('local accounts (Etap 3)', () => {
  it('rejects login with a wrong password', async () => {
    const { app, repository } = buildTestApp();
    await createTestUser(repository, 'admin', 'correct-password', 'admin');

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
    await createTestUser(repository, 'operator', 'test-password', 'viewer');
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

  // A5: a malformed percent-escape used to make parseCookies's
  // decodeURIComponent throw, turning an attacker-controlled cookie
  // header into an unhandled exception (500) instead of "unauthenticated".
  it('rejects a malformed (invalid percent-encoding) cookie value without throwing a 500', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE_NAME}=%E0%A4%A`);
    expect(res.status).toBe(401);
  });

  // A5: expiry is enforced, not just "row exists" — a session whose
  // expires_at is already in the past must behave exactly like no
  // session at all.
  it('rejects an expired session token', async () => {
    const { app, repository } = buildTestApp();
    const user = await createTestUser(repository, 'admin', 'test-password', 'admin');
    const token = generateSessionToken();
    const past = new Date(Date.now() - 60_000).toISOString();
    repository.createSession({ tokenHash: hashSecret(token), userId: user.id, now: past, expiresAt: past });

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(401);
  });
});

// A2: bounded in-memory login-abuse limiter. Verified purely through
// synchronous state transitions (no real waiting on the backoff window)
// — once the threshold is crossed, the very next attempt must be
// rejected before it even touches the password check.
describe('login attempt limiter (A2)', () => {
  it('blocks further attempts for the same username+IP once the failure threshold is exceeded', async () => {
    const { app, repository } = buildTestApp();
    await createTestUser(repository, 'admin', 'correct-password', 'admin');

    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'wrong' });
      lastStatus = res.status;
    }
    // The 6th failure itself still reports invalid_credentials; only the
    // attempt AFTER crossing the threshold gets rate-limited.
    expect(lastStatus).toBe(401);

    const blocked = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(blocked.status).toBe(429);

    // A correct password for a DIFFERENT username from the same caller
    // must not be affected — the limiter is keyed per username+IP, not
    // just per IP.
    await createTestUser(repository, 'someone-else', 'correct-password', 'admin');
    const other = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'someone-else', password: 'correct-password' });
    expect(other.status).toBe(200);
  });

  it('resets the failure count after a successful login', async () => {
    const { app, repository } = buildTestApp();
    await createTestUser(repository, 'admin', 'correct-password', 'admin');

    await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'wrong' });
    await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'wrong' });
    const success = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'correct-password' });
    expect(success.status).toBe(200);

    // Post-reset, a fresh run of failures must start from zero again
    // rather than continuing to accumulate toward the earlier block.
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'wrong' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(401);
  });
});
