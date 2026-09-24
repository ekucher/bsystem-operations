import type { OperationsRepository } from './repository.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Grilling Q15: keep 90 days of event history. Runs once at startup (so a
// long-stopped process doesn't accumulate a backlog silently) and then
// daily — event volume here is small enough that a heavier cron-style
// scheduler would be pure overhead.
// D10 (Wave 2 hardening): the callback body is wrapped in try/catch so a
// single bad tick (e.g. a transient DB error) logs and lets the NEXT tick
// still fire on schedule, rather than throwing inside the setInterval
// callback — an uncaught exception there does not automatically restart
// the interval, so it would otherwise silently kill this housekeeping
// forever (or, depending on how it's wired, take down the whole process)
// without the API's core request handling ever being affected.
export function scheduleRetentionCleanup(repository: OperationsRepository, retentionDays: number): NodeJS.Timeout {
  const run = (): void => {
    try {
      const cutoffIso = new Date(Date.now() - retentionDays * ONE_DAY_MS).toISOString();
      const deleted = repository.deleteEventsOlderThan(cutoffIso);
      if (deleted > 0) {
        // eslint-disable-next-line no-console
        console.log(`retention: deleted ${deleted} event(s) older than ${retentionDays}d`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('retention: cleanup tick failed', err);
    }
  };
  run();
  return setInterval(run, ONE_DAY_MS);
}

const PENDING_KEY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// D5 (agent-enrollment hardening): sweep any pending_api_key past its
// reveal TTL (see repository.PENDING_KEY_TTL_MS / readPendingApiKey) so
// an approved server whose agent never successfully polled doesn't
// leave a plaintext key sitting in the DB indefinitely (Finding 4).
// readPendingApiKey already refuses to return an expired key on its
// own (correctness does not depend on this sweep ever running) — this
// is hygiene, so the plaintext column itself doesn't linger in the DB
// file past its window even if nobody ever reads it again. Interval
// matches the TTL itself: no point sweeping more often than keys can
// expire.
// D10: same try/catch rationale as scheduleRetentionCleanup above.
export function schedulePendingKeyCleanup(repository: OperationsRepository): NodeJS.Timeout {
  const run = (): void => {
    try {
      const expired = repository.expirePendingApiKeys(new Date().toISOString());
      if (expired > 0) {
        // eslint-disable-next-line no-console
        console.log(`pending-key cleanup: expired ${expired} pending API key(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('pending-key cleanup: tick failed', err);
    }
  };
  run();
  return setInterval(run, PENDING_KEY_SWEEP_INTERVAL_MS);
}
