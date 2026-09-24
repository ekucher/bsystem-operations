import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { LoginAttemptLimiter, SESSION_COOKIE_NAME, parseCookies, requireSameOrigin, requireSession } from '../auth.js';
import { generateSessionToken, getDummyPasswordHash, hashSecret, verifyPassword } from '../crypto.js';
import { LoginRequest } from '../schemas.js';
import type { OperationsRepository } from '../repository.js';

// Local accounts (Etap 3). No self-registration route on purpose — the
// only way to create a user is the create-admin CLI (see
// src/cli/create-admin.ts) or a DB row inserted by that same path later
// for additional users; an open POST /auth/register would let anyone who
// can reach the API mint themselves an account.
export function createAuthRouter(repository: OperationsRepository, config: AppConfig): Router {
  const router = Router();
  // Scoped to this router instance (not a module-level singleton) so
  // separate app instances — notably each test's buildTestApp() — don't
  // share failure counters.
  const loginLimiter = new LoginAttemptLimiter();

  router.post('/auth/login', async (req, res) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { username, password } = parsed.data;
    const ip = req.ip ?? 'unknown';

    const retryInMs = loginLimiter.msUntilAllowed(username, ip);
    if (retryInMs > 0) {
      res.status(429).json({ error: 'too_many_attempts', retryAfterMs: retryInMs });
      return;
    }

    const user = repository.getUserByUsername(username);
    // Whether or not the username exists, run a real scrypt comparison
    // of equivalent cost before answering — an unknown username that
    // fast-paths straight to 401 while a known one pays the scrypt
    // cost is a timing side-channel that lets a caller enumerate valid
    // usernames from response latency alone.
    const passwordHash = user?.password_hash ?? (await getDummyPasswordHash());
    const passwordValid = await verifyPassword(password, passwordHash);

    // Same "invalid_credentials" response whether the username doesn't
    // exist or the password is wrong — a distinct "no such user" answer
    // would let a caller enumerate valid usernames.
    if (!user || !passwordValid) {
      loginLimiter.recordFailure(username, ip);
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    loginLimiter.recordSuccess(username, ip);

    const token = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.sessionTtlHours * 60 * 60 * 1000);
    repository.createSession({
      tokenHash: hashSecret(token),
      userId: user.id,
      now: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      // Strict (not Lax): this cookie only needs to ride requests the
      // dashboard itself initiates, never a top-level cross-site
      // navigation — Strict is the tighter CSRF posture and costs
      // nothing here (see requireSameOrigin for the belt-and-braces
      // check on the mutating routes too).
      sameSite: 'strict',
      path: '/',
      maxAge: config.sessionTtlHours * 60 * 60 * 1000,
    });
    res.status(200).json({ username: user.username, role: user.role });
  });

  router.post('/auth/logout', requireSession(repository), requireSameOrigin(), (req, res) => {
    const token = parseCookies(req.header('Cookie'))[SESSION_COOKIE_NAME];
    if (token) {
      repository.deleteSessionByTokenHash(hashSecret(token));
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(204).end();
  });

  router.get('/auth/me', requireSession(repository), (req, res) => {
    res.status(200).json({ username: req.authUser!.username, role: req.authUser!.role });
  });

  return router;
}
