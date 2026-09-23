import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';
import { hashSecret, secretsMatch } from './crypto.js';
import type { OperationsRepository, ServerRow } from './repository.js';

declare module 'express-serve-static-core' {
  interface Request {
    operationsServer?: ServerRow;
  }
}

// Interim v1 admin auth (grilling decision: local accounts belong to
// Etap 3's UI work, not this backend-foundation etap). A single shared
// key is a deliberately narrow placeholder — Etap 3 replaces this
// middleware wholesale, it does not extend it.
export function requireAdmin(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.adminApiKey) {
      // Fail closed: an unconfigured admin key must never be treated as
      // "no auth required".
      res.status(503).json({ error: 'admin_not_configured' });
      return;
    }
    const provided = req.header('X-Admin-Key');
    if (!secretsMatch(provided, config.adminApiKey)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
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
