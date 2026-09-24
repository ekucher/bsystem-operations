import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { LoginAttemptLimiter, requireSameOrigin } from './auth.js';

// Minimal Request/Response doubles — requireSameOrigin only ever calls
// req.header() and res.status()/res.json(), so a full Express app isn't
// needed to exercise its comparison logic directly.
function fakeReq(headers: Record<string, string | undefined>): Request {
  return {
    header: (name: string) => headers[name],
  } as unknown as Request;
}

function fakeRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown };
}

// B1/B2: this is the exact bug the real deployment hit. Before the
// ui/nginx.conf fix, `proxy_set_header Host $host;` forwarded a Host
// header with the client's port STRIPPED, while Origin (set by the
// browser from the page's actual origin) always keeps its port — so
// `new URL(origin).host` ("localhost:8082") never equalled
// `req.header('Host')` ("localhost", no port) for any real deployment
// where the UI isn't served on the bare default port. Both cases below
// are the ones that must hold post-fix, once nginx forwards `$http_host`
// (port preserved) instead.
describe('requireSameOrigin — real reverse-proxy Host/Origin shapes', () => {
  it('allows a same-origin request where both Host and Origin carry the same non-default port', () => {
    const middleware = requireSameOrigin();
    const req = fakeReq({ Origin: 'http://localhost:8082', Host: 'localhost:8082' });
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin request even when Host carries a non-default port', () => {
    const middleware = requireSameOrigin();
    const req = fakeReq({ Origin: 'http://evil.example', Host: 'localhost:8082' });
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'cross_origin_forbidden' });
  });

  // This is exactly what shipped broken: nginx stripping the port from
  // Host while Origin keeps it. Kept here as a named regression case
  // (distinct from the two above) so a future change can't silently
  // reintroduce "port-stripped Host, port-carrying Origin" as a treated
  // -as-same-origin case, nor treat it as blocking legitimate traffic
  // forever by coincidence.
  it('rejects when Host has been stripped of its port but Origin still carries one (the pre-fix nginx bug)', () => {
    const middleware = requireSameOrigin();
    const req = fakeReq({ Origin: 'http://localhost:8082', Host: 'localhost' });
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

// B4/B5: the coarser, IP-only limiter. Keyed purely on the caller's IP
// (via the `keyOf` override), independent of username — this is what
// stops an attacker who rotates the username on every attempt from
// evading the per-username+IP limiter (each individual username+IP key
// never crosses its own threshold, since no key is ever reused).
describe('LoginAttemptLimiter — IP-only keying (B4)', () => {
  it('blocks a random-username flood from a single IP even though no single username+IP key crosses its own threshold', () => {
    let now = 0;
    const clock = () => now;
    const ip = '203.0.113.5';
    const maxAttempts = 5;
    const ipLimiter = new LoginAttemptLimiter(maxAttempts, 30_000, clock, (_username, callerIp) => callerIp);

    for (let i = 0; i < maxAttempts; i++) {
      // A different, never-reused username on every single attempt.
      ipLimiter.recordFailure(`attacker-${i}`, ip);
      expect(ipLimiter.msUntilAllowed(`attacker-${i}`, ip)).toBe(0);
    }
    // The (maxAttempts+1)th failure — from yet another brand-new
    // username — must still trip the IP-keyed limiter.
    ipLimiter.recordFailure('attacker-final', ip);
    expect(ipLimiter.msUntilAllowed('anything-at-all', ip)).toBeGreaterThan(0);

    // A completely different IP is unaffected.
    expect(ipLimiter.msUntilAllowed('attacker-0', '198.51.100.9')).toBe(0);
  });

  it('does not block distinct usernames on the SAME IP under the default per-username+IP keying', () => {
    let now = 0;
    const clock = () => now;
    const ip = '203.0.113.5';
    const perKeyLimiter = new LoginAttemptLimiter(5, 30_000, clock);

    for (let i = 0; i < 10; i++) {
      perKeyLimiter.recordFailure('same-username', ip);
    }
    expect(perKeyLimiter.msUntilAllowed('same-username', ip)).toBeGreaterThan(0);
    // A different username sharing the same IP has its own, untouched key.
    expect(perKeyLimiter.msUntilAllowed('different-username', ip)).toBe(0);
  });
});

// B4/B5: the Map backing LoginAttemptLimiter must not grow without
// bound — a rotating-username (or rotating-IP, behind a botnet) flood
// must eventually be forgotten once it's gone idle, or the process leaks
// memory for as long as it runs.
describe('LoginAttemptLimiter — bounded memory via sweep() (B4)', () => {
  it('evicts entries whose block window has expired and that have been idle past the idle threshold', () => {
    let now = 0;
    const clock = () => now;
    const limiter = new LoginAttemptLimiter(1, 1_000, clock);

    for (let i = 0; i < 50; i++) {
      limiter.recordFailure(`user-${i}`, '198.51.100.1');
    }
    expect(limiter.size).toBe(50);

    // Not idle long enough yet — nothing should be evicted.
    now += 500;
    expect(limiter.sweep(60_000)).toBe(0);
    expect(limiter.size).toBe(50);

    // Past both the block window (short, capped at baseWindowMs*16=16s)
    // and the idle threshold — every entry is safe to forget now.
    now += 120_000;
    const evicted = limiter.sweep(60_000);
    expect(evicted).toBe(50);
    expect(limiter.size).toBe(0);
  });

  it('never evicts an entry that is still within its active block window, even if sweep is called', () => {
    let now = 0;
    const clock = () => now;
    const limiter = new LoginAttemptLimiter(1, 30_000, clock);

    for (let i = 0; i < 3; i++) {
      limiter.recordFailure('flooder', '198.51.100.1');
    }
    expect(limiter.msUntilAllowed('flooder', '198.51.100.1')).toBeGreaterThan(0);

    // Even with an enormous idle threshold, an entry still mid-backoff
    // must never be swept — sweep() only removes fully-expired blocks.
    now += 1;
    expect(limiter.sweep(0)).toBe(0);
    expect(limiter.size).toBe(1);
  });
});
