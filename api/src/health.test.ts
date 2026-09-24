import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './testUtils.js';
import { isDbReady } from './health.js';
import { openDb } from './db.js';

describe('GET /health', () => {
  it('returns the Module Registry health contract shape', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'bsystem-operations-api',
    });
    expect(typeof res.body.version).toBe('string');
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
  });

  it('surfaces the configured build revision', async () => {
    const { app } = buildTestApp({ gitSha: 'deadbeef' });
    const res = await request(app).get('/health');
    expect(res.body.revision).toBe('deadbeef');
  });

  it('answers 200 even without touching the database (liveness only)', async () => {
    const { app, db } = buildTestApp();
    db.close();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('GET /ready', () => {
  it('returns 200 when the database is reachable', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('returns 503 when the database handle has been closed', async () => {
    const { app, db } = buildTestApp();
    db.close();
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error' });
  });
});

describe('isDbReady', () => {
  it('is true for an open, queryable database', () => {
    expect(isDbReady(openDb(':memory:'))).toBe(true);
  });

  it('is false once the database handle is closed', () => {
    const db = openDb(':memory:');
    db.close();
    expect(isDbReady(db)).toBe(false);
  });
});
