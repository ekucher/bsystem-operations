import type { OperationsRepository } from './repository.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Grilling Q15: keep 90 days of event history. Runs once at startup (so a
// long-stopped process doesn't accumulate a backlog silently) and then
// daily — event volume here is small enough that a heavier cron-style
// scheduler would be pure overhead.
export function scheduleRetentionCleanup(repository: OperationsRepository, retentionDays: number): NodeJS.Timeout {
  const run = (): void => {
    const cutoffIso = new Date(Date.now() - retentionDays * ONE_DAY_MS).toISOString();
    const deleted = repository.deleteEventsOlderThan(cutoffIso);
    if (deleted > 0) {
      // eslint-disable-next-line no-console
      console.log(`retention: deleted ${deleted} event(s) older than ${retentionDays}d`);
    }
  };
  run();
  return setInterval(run, ONE_DAY_MS);
}
