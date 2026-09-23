import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { OperationsRepository } from './repository.js';
import { scheduleRetentionCleanup } from './retention.js';

const config = loadConfig();

if (!config.bootstrapSecret) {
  // eslint-disable-next-line no-console
  console.warn('OPERATIONS_BOOTSTRAP_SECRET not set — enrollment is disabled until it is configured.');
}
if (!config.adminApiKey) {
  // eslint-disable-next-line no-console
  console.warn('ADMIN_API_KEY not set — approval/admin routes are disabled until it is configured.');
}

const db = openDb(config.dbPath);
const repository = new OperationsRepository(db);
const app = createApp(repository, config);

scheduleRetentionCleanup(repository, config.eventRetentionDays);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`bsystem-operations-api listening on :${config.port}`);
});
