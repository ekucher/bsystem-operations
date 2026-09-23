import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PackageManifest {
  version: string;
}

// Read once at module load rather than per-request; the version does not
// change while the process is running.
const packageManifest = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'),
) as PackageManifest;

export const healthRouter = Router();

// Contract required of every BSYSTEM module by the platform's Module
// Registry (ТЗ §27): GET /health -> {status, service, version, timestamp}.
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'bsystem-operations-api',
    version: packageManifest.version,
    timestamp: new Date().toISOString(),
  });
});
