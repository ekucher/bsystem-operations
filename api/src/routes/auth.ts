import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { SESSION_COOKIE_NAME, parseCookies, requireSession } from '../auth.js';
import { generateSessionToken, hashSecret, verifyPassword } from '../crypto.js';
import { LoginRequest } from '../schemas.js';
import type { OperationsRepository } from '../repository.js';

// Local accounts (Etap 3). No self-registration route on purpose — the
// only way to create a user is the create-admin CLI (see
// src/cli/create-admin.ts) or a DB row inserted by that same path later
// for additional users; an open POST /auth/register would let anyone who
// can reach the API mint themselves an account.
export function createAuthRouter(repository: OperationsRepository, config: AppConfig): Router {
  const router = Router();

  router.post('/auth/login', (req, res) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const user = repository.getUserByUsername(parsed.data.username);
    // Same "invalid_credentials" response whether the username doesn't
    // exist or the password is wrong — a distinct "no such user" answer
    // would let a caller enumerate valid usernames.
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
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
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionTtlHours * 60 * 60 * 1000,
    });
    res.status(200).json({ username: user.username, role: user.role });
  });

  router.post('/auth/logout', requireSession(repository), (req, res) => {
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
