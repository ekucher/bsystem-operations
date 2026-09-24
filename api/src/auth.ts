import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';
import { hashSecret, secretsMatch } from './crypto.js';
import type { OperationsRepository, ServerRow, UserRow } from './repository.js';

export const SESSION_COOKIE_NAME = 'ops_session';

declare module 'express-serve-static-core' {
  interface Request {
    operationsServer?: ServerRow;
    authUser?: UserRow;
  }
}

// Manual parse instead of the `cookie-parser` package: one cookie, one
// call site (requireSession below) — a dependency would buy nothing here.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) {
      // A malformed percent-escape (e.g. a lone "%" or "%zz") makes
      // decodeURIComponent throw — an attacker-controlled cookie header
      // must not be able to turn a GET into an unhandled exception (500)
      // instead of "unauthenticated". Fall back to the raw value.
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

// Etap 3: local accounts replace the interim X-Admin-Key wholesale (see
// git history for the key-based requireAdmin this superseded). Every
// authenticated route — viewer or admin — passes through this first;
// requireRole layers an additional role check on top.
export function requireSession(repository: OperationsRepository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = parseCookies(req.header('Cookie'))[SESSION_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const session = repository.getSessionByTokenHash(hashSecret(token), new Date().toISOString());
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.authUser = session.user;
    next();
  };
}

export function requireRole(repository: OperationsRepository, role: UserRow['role']) {
  const authed = requireSession(repository);
  return (req: Request, res: Response, next: NextFunction): void => {
    authed(req, res, () => {
      if (req.authUser?.role !== role) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      next();
    });
  };
}

export function requireBootstrapSecret(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.bootstrapSecret) {
      res.status(503).json({ error: 'enrollment_not_configured' });
      return;
    }
    const provided = (req.body as { bootstrapSecret?: string } | undefined)?.bootstrapSecret;
    if (!secretsMatch(provided, config.bootstrapSecret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;

// Expired sessions are already treated as absent by getSessionByTokenHash
// (see repository.ts), so this sweep is pure housekeeping — it keeps the
// sessions table from growing unbounded, not a security control. Same
// "run once at startup, then on an interval" convention as
// retention.ts's scheduleRetentionCleanup.
export function scheduleSessionCleanup(repository: OperationsRepository): NodeJS.Timeout {
  const run = (): void => {
    const deleted = repository.deleteExpiredSessions(new Date().toISOString());
    if (deleted > 0) {
      // eslint-disable-next-line no-console
      console.log(`session cleanup: deleted ${deleted} expired session(s)`);
    }
  };
  run();
  return setInterval(run, ONE_HOUR_MS);
}

export function requireApiKey(repository: OperationsRepository) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.header('X-Api-Key');
    if (!apiKey) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const server = repository.findApprovedServerByApiKeyHash(hashSecret(apiKey));
    if (!server) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.operationsServer = server;
    next();
  };
}

interface LoginAttemptRecord {
  failures: number;
  blockedUntil: number;
  // Last time this key saw any activity (a failure or a success-driven
  // reset touch) — used only by sweep() to find keys that are safe to
  // forget; it never affects msUntilAllowed/recordFailure's own logic.
  lastActivityAt: number;
}

// Bounded in-memory login-abuse guard. No Redis: one process, modest
// login volume — a Map that forgets everything on restart is an
// acceptable tradeoff for the complexity it avoids. Each router instance
// owns its own limiters (see routes/auth.ts) so tests (and, if this
// process is ever clustered, each worker) don't share state across
// unrelated logins.
//
// `keyOf` decides the granularity: routes/auth.ts instantiates this
// twice — once keyed on username+IP (tight threshold, the original A2
// guard) and once keyed on IP alone (coarser, higher threshold). Keying
// solely on username+IP is bypassable by an attacker who rotates the
// username on every request from the same IP: each individual
// username+IP key stays under its own threshold forever, even though
// the same caller is hammering the login endpoint. The IP-only limiter
// catches exactly that flood without punishing the (common) case of one
// IP serving several genuine accounts.
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, LoginAttemptRecord>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly baseWindowMs = 30_000,
    private readonly clock: () => number = Date.now,
    private readonly keyOf: (username: string, ip: string) => string = (username, ip) => `${username} ${ip}`,
  ) {}

  // Returns the remaining block time in ms, or 0 if the caller may
  // attempt a login right now.
  msUntilAllowed(username: string, ip: string): number {
    const record = this.attempts.get(this.keyOf(username, ip));
    if (!record) {
      return 0;
    }
    const remaining = record.blockedUntil - this.clock();
    return remaining > 0 ? remaining : 0;
  }

  // Exponential backoff past the threshold: the (threshold+1)th failure
  // blocks for one window, the next for two windows, then four, capped
  // so a persistent attacker can't wedge a key out indefinitely.
  recordFailure(username: string, ip: string): void {
    const key = this.keyOf(username, ip);
    const record = this.attempts.get(key) ?? { failures: 0, blockedUntil: 0, lastActivityAt: this.clock() };
    record.failures += 1;
    record.lastActivityAt = this.clock();
    if (record.failures > this.maxAttempts) {
      const overBy = record.failures - this.maxAttempts - 1;
      const backoffMs = Math.min(this.baseWindowMs * 2 ** overBy, this.baseWindowMs * 16);
      record.blockedUntil = this.clock() + backoffMs;
    }
    this.attempts.set(key, record);
  }

  recordSuccess(username: string, ip: string): void {
    this.attempts.delete(this.keyOf(username, ip));
  }

  // Housekeeping only — correctness never depends on this running (a
  // stale, never-blocked entry is functionally identical to no entry at
  // all; msUntilAllowed/recordFailure both work fine on a fresh key).
  // Without it, an attacker rotating usernames (or IPs, behind a botnet)
  // leaves one Map entry per unique key forever — an unbounded memory
  // leak. Sweeps any entry whose block window has fully expired AND that
  // has seen no activity for `maxIdleMs`, so an entry mid-backoff is
  // never evicted early. Same "run once at startup, then on an interval"
  // convention as retention.ts's scheduled cleanups.
  sweep(maxIdleMs: number): number {
    const now = this.clock();
    let removed = 0;
    for (const [key, record] of this.attempts) {
      if (record.blockedUntil <= now && now - record.lastActivityAt >= maxIdleMs) {
        this.attempts.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.attempts.size;
  }
}

const LOGIN_LIMITER_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const LOGIN_LIMITER_MAX_IDLE_MS = 60 * 60 * 1000;

// See LoginAttemptLimiter.sweep's doc comment. Called once per router
// instance from routes/auth.ts at router-construction time (not plumbed
// through index.ts's explicit-shutdown timer list like
// scheduleSessionCleanup/scheduleRetentionCleanup are, since the
// limiters themselves are private to createAuthRouter) — `.unref()` so
// this interval alone never keeps the process alive or blocks a clean
// shutdown, and so it doesn't show up as a leaked handle in tests that
// build many short-lived apps (see testUtils.buildTestApp).
export function scheduleLoginLimiterCleanup(...limiters: LoginAttemptLimiter[]): NodeJS.Timeout {
  const run = (): void => {
    let total = 0;
    for (const limiter of limiters) {
      total += limiter.sweep(LOGIN_LIMITER_MAX_IDLE_MS);
    }
    if (total > 0) {
      // eslint-disable-next-line no-console
      console.log(`login-limiter cleanup: evicted ${total} stale entr${total === 1 ? 'y' : 'ies'}`);
    }
  };
  const timer = setInterval(run, LOGIN_LIMITER_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

// CSRF posture (browser cookie-authed mutations only — API-key/bootstrap
// flows never send a session cookie, so they're outside this check by
// construction). Browsers attach an `Origin` header to every cross-site
// AND same-site fetch/XHR that uses an "unsafe" method (POST etc.), so a
// forged cross-site request riding the session cookie will present an
// Origin that doesn't match this server's own Host — that's the case
// this rejects. A request with no Origin header at all (plain curl,
// server-to-server calls, older/non-fetch clients) is left alone rather
// than blocked outright: the absence of Origin isn't itself evidence of
// a cross-site browser request, only a present-and-wrong one is.
export function requireSameOrigin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.header('Origin');
    if (!origin) {
      next();
      return;
    }
    const host = req.header('Host');
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      res.status(403).json({ error: 'invalid_origin' });
      return;
    }
    if (!host || originHost !== host) {
      res.status(403).json({ error: 'cross_origin_forbidden' });
      return;
    }
    next();
  };
}
