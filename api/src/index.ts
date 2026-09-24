import { createApp } from './app.js';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';
import { scheduleOfflineMonitor } from './offlineMonitor.js';
import { scheduleRetentionCleanup } from './retention.js';

// Fail fast with a readable message (not a stack trace, not a silent
// NaN/undefined creeping into request handling) when the environment is
// malformed — see config.ts's zod schema for what "malformed" covers.
function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err instanceof ConfigError ? err.message : `Failed to load configuration: ${String(err)}`);
    return process.exit(1);
  }
}

const config = loadConfigOrExit();

if (!config.bootstrapSecret) {
  // eslint-disable-next-line no-console
  console.warn('OPERATIONS_BOOTSTRAP_SECRET not set — enrollment is disabled until it is configured.');
}

const db = openDb(config.dbPath);
const repository = new OperationsRepository(db);
const app = createApp(repository, config, db);

const retentionTimer = scheduleRetentionCleanup(repository, config.eventRetentionDays);
const offlineTimer = scheduleOfflineMonitor(repository, config);

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`bsystem-operations-api listening on :${config.port}`);
});

// Simple, direct shutdown — no hook framework needed at this codebase's
// size: stop the background timers so they can't fire mid-shutdown, stop
// accepting new connections but let in-flight ones finish, then close the
// DB handle (WAL checkpoint happens here) and exit.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down...`);

  clearInterval(retentionTimer);
  if (offlineTimer) {
    clearInterval(offlineTimer);
  }

  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('Error while closing HTTP server:', err);
    }
    try {
      db.close();
    } catch (dbErr) {
      // eslint-disable-next-line no-console
      console.error('Error while closing database handle:', dbErr);
    }
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
