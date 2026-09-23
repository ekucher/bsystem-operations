import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';
import { scheduleOfflineMonitor } from './offlineMonitor.js';
import { scheduleRetentionCleanup } from './retention.js';

const config = loadConfig();

if (!config.bootstrapSecret) {
  // eslint-disable-next-line no-console
  console.warn('OPERATIONS_BOOTSTRAP_SECRET not set — enrollment is disabled until it is configured.');
}

const db = openDb(config.dbPath);
const repository = new OperationsRepository(db);
const app = createApp(repository, config);

scheduleRetentionCleanup(repository, config.eventRetentionDays);
scheduleOfflineMonitor(repository, config);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`bsystem-operations-api listening on :${config.port}`);
});
