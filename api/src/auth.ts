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
      out[key] = decodeURIComponent(value);
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
