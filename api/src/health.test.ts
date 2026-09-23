import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './testUtils.js';

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
});
