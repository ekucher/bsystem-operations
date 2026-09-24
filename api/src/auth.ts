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
// D10 (Wave 2 hardening): try/catch around the callback body so a single
// bad tick (transient DB error) logs and lets the next scheduled tick
// still fire, instead of throwing inside the setInterval callback — which
// would silently kill this interval forever (or worse) without affecting
// the rest of the process.
export function scheduleSessionCleanup(repository: OperationsRepository): NodeJS.Timeout {
  const run = (): void => {
    try {
      const deleted = repository.deleteExpiredSessions(new Date().toISOString());
      if (deleted > 0) {
        // eslint-disable-next-line no-console
        console.log(`session cleanup: deleted ${deleted} expired session(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('session cleanup: tick failed', err);
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

// Bounded in-memory login-abuse guard, keyed on username+IP. No Redis:
// one process, modest login volume — a Map that forgets everything on
// restart is an acceptable tradeoff for the complexity it avoids. Each
// router instance owns its own limiter (see routes/auth.ts) so tests
// (and, if this process is ever clustered, each worker) don't share
// state across unrelated logins.
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, { failures: number; blockedUntil: number }>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly baseWindowMs = 30_000,
    private readonly clock: () => number = Date.now,
  ) {}

  private key(username: string, ip: string): string {
    return `${username} ${ip}`;
  }

  // Returns the remaining block time in ms, or 0 if the caller may
  // attempt a login right now.
  msUntilAllowed(username: string, ip: string): number {
    const record = this.attempts.get(this.key(username, ip));
    if (!record) {
      return 0;
    }
    const remaining = record.blockedUntil - this.clock();
    return remaining > 0 ? remaining : 0;
  }

  // Exponential backoff past the threshold: the (threshold+1)th failure
  // blocks for one window, the next for two windows, then four, capped
  // so a persistent attacker can't wedge a username out indefinitely.
  recordFailure(username: string, ip: string): void {
    const key = this.key(username, ip);
    const record = this.attempts.get(key) ?? { failures: 0, blockedUntil: 0 };
    record.failures += 1;
    if (record.failures > this.maxAttempts) {
      const overBy = record.failures - this.maxAttempts - 1;
      const backoffMs = Math.min(this.baseWindowMs * 2 ** overBy, this.baseWindowMs * 16);
      record.blockedUntil = this.clock() + backoffMs;
    }
    this.attempts.set(key, record);
  }

  recordSuccess(username: string, ip: string): void {
    this.attempts.delete(this.key(username, ip));
  }
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
