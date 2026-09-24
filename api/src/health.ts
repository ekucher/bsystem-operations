import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db.js';
import type { AppConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PackageManifest {
  version: string;
}

// Read once at module load rather than per-request; the version does not
// change while the process is running.
const packageManifest = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'),
) as PackageManifest;

// Pure so it's testable without standing up an Express route or actually
// destroying a database file on disk — a test can hand this any Db
// (including one whose handle has already been closed) and check the
// return value directly.
export function isDbReady(db: Db): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

// Liveness (/health) vs readiness (/ready) split: liveness must answer
// even if the database is temporarily locked/unavailable, or a naive
// "the healthcheck failed, restart the container" reaction to a passing
// DB blip kills a process that would otherwise recover on its own.
// Readiness is what should gate "can this container actually serve
// traffic" decisions (Docker HEALTHCHECK, a future orchestrator).
export function createHealthRouter(db: Db, config: Pick<AppConfig, 'gitSha'>): Router {
  const router = Router();

  // Contract required of every BSYSTEM module by the platform's Module
  // Registry (ТЗ §27): GET /health -> {status, service, version, timestamp}.
  // `revision` is additive (git SHA the running image was built from,
  // "unknown" if nothing supplied one) — not part of that contract, but
  // useful for "which build is this" debugging and doesn't break it.
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'bsystem-operations-api',
      version: packageManifest.version,
      revision: config.gitSha,
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', (_req, res) => {
    if (isDbReady(db)) {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    } else {
      res.status(503).json({
        status: 'error',
        reason: 'database unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
