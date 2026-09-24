import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from './db.js';
import {
  computeOfflineTransitions,
  formatOfflineMessage,
  formatRecoveryMessage,
  runOfflineCheck,
  scheduleOfflineMonitor,
} from './offlineMonitor.js';
import { OperationsRepository, type ServerRow } from './repository.js';

const SERVER_ID = '44444444-4444-4444-8444-444444444444';

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function makeServer(overrides: Partial<ServerRow> = {}): ServerRow {
  return {
    id: SERVER_ID,
    institution_code: '01234567',
    product_type: 'LIMS',
    hostname: 'HOUSE-LIMS-01',
    status: 'approved',
    api_key_hash: 'hash',
    pending_api_key: null,
    bravo_version: null,
    created_at: isoMinutesAgo(1000),
    approved_at: isoMinutesAgo(1000),
    last_seen_at: null,
    last_heartbeat_at: null,
    offline_alerted_at: null,
    ...overrides,
  };
}

describe('computeOfflineTransitions', () => {
  it('flags a never-alerted offline server as went-offline', () => {
    const server = makeServer({ last_heartbeat_at: isoMinutesAgo(1000) });
    const transitions = computeOfflineTransitions([server], new Date(), 60, 2);
    expect(transitions).toEqual([{ server, kind: 'went-offline' }]);
  });

  it('does not re-flag an already-alerted offline server', () => {
    const server = makeServer({ last_heartbeat_at: isoMinutesAgo(1000), offline_alerted_at: isoMinutesAgo(10) });
    expect(computeOfflineTransitions([server], new Date(), 60, 2)).toEqual([]);
  });

  it('flags a recovered server (online again, still marked alerted)', () => {
    const server = makeServer({ last_heartbeat_at: isoMinutesAgo(1), offline_alerted_at: isoMinutesAgo(10) });
    const transitions = computeOfflineTransitions([server], new Date(), 60, 2);
    expect(transitions).toEqual([{ server, kind: 'recovered' }]);
  });

  it('ignores an online server with no prior alert', () => {
    const server = makeServer({ last_heartbeat_at: isoMinutesAgo(1) });
    expect(computeOfflineTransitions([server], new Date(), 60, 2)).toEqual([]);
  });

  it('ignores a pending (never approved) server even without any heartbeat', () => {
    const server = makeServer({ status: 'pending', api_key_hash: null, last_heartbeat_at: null });
    expect(computeOfflineTransitions([server], new Date(), 60, 2)).toEqual([]);
  });
});

describe('message formatters', () => {
  it('formats an offline message including hostname, institution and last heartbeat', () => {
    const server = makeServer({ last_heartbeat_at: '2026-09-01T00:00:00.000Z' });
    const message = formatOfflineMessage(server);
    expect(message).toContain('HOUSE-LIMS-01');
    expect(message).toContain('01234567');
    expect(message).toContain('2026-09-01T00:00:00.000Z');
  });

  it('formats a never-heartbeat offline message without throwing', () => {
    const server = makeServer({ last_heartbeat_at: null });
    expect(formatOfflineMessage(server)).toContain('ніколи');
  });

  it('formats a recovery message including hostname', () => {
    const server = makeServer();
    expect(formatRecoveryMessage(server)).toContain('HOUSE-LIMS-01');
  });
});

describe('runOfflineCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op when no webhook URL is configured', async () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      claim: 'test-claim',
      now: isoMinutesAgo(1000),
    });
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', isoMinutesAgo(1000));
    repository.touchHeartbeat(SERVER_ID, isoMinutesAgo(1000), undefined);

    const config = {
      discordAlertsWebhookUrl: undefined,
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
    } as const;

    await runOfflineCheck(repository, config as never, new Date());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends an offline alert and sets the dedup marker exactly once across two ticks', async () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      claim: 'test-claim',
      now: isoMinutesAgo(1000),
    });
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', isoMinutesAgo(1000));
    repository.touchHeartbeat(SERVER_ID, isoMinutesAgo(1000), undefined);

    const config = {
      discordAlertsWebhookUrl: 'https://discord.test/webhook',
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
    } as const;

    await runOfflineCheck(repository, config as never, new Date());
    expect(fetch).toHaveBeenCalledTimes(1);
    const afterFirst = repository.getServer(SERVER_ID)!;
    expect(afterFirst.offline_alerted_at).not.toBeNull();

    await runOfflineCheck(repository, config as never, new Date());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends a recovery alert and clears the dedup marker once the server is back online', async () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      claim: 'test-claim',
      now: isoMinutesAgo(1000),
    });
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', isoMinutesAgo(1000));
    repository.markOfflineAlerted(SERVER_ID, isoMinutesAgo(30));
    repository.touchHeartbeat(SERVER_ID, isoMinutesAgo(1), undefined);

    const config = {
      discordAlertsWebhookUrl: 'https://discord.test/webhook',
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
    } as const;

    await runOfflineCheck(repository, config as never, new Date());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(repository.getServer(SERVER_ID)!.offline_alerted_at).toBeNull();
  });

  it('does not write the dedup marker when the Discord send fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      claim: 'test-claim',
      now: isoMinutesAgo(1000),
    });
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', isoMinutesAgo(1000));
    repository.touchHeartbeat(SERVER_ID, isoMinutesAgo(1000), undefined);

    const config = {
      discordAlertsWebhookUrl: 'https://discord.test/webhook',
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
    } as const;

    await runOfflineCheck(repository, config as never, new Date());
    expect(repository.getServer(SERVER_ID)!.offline_alerted_at).toBeNull();
  });
});

// D5 (Wave 2 hardening): a freshly-approved server has no last_heartbeat_at
// yet — its agent hasn't sent a first heartbeat. It must get the same
// grace window from approved_at that an already-reporting server gets
// between heartbeats, not be flagged offline immediately.
describe('runOfflineCheck grace period for freshly-approved servers (D5)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not alert immediately after approval, before any heartbeat is due', async () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      now: isoMinutesAgo(5),
    });
    const approvedAt = new Date().toISOString();
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', approvedAt);
    // No touchHeartbeat call — the agent has not checked in yet.

    const config = {
      discordAlertsWebhookUrl: 'https://discord.test/webhook',
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
    } as const;

    // Run the check immediately (same instant as approval).
    await runOfflineCheck(repository, config as never, new Date(Date.parse(approvedAt)));
    expect(fetch).not.toHaveBeenCalled();
    expect(repository.getServer(SERVER_ID)!.offline_alerted_at).toBeNull();
  });

  it('alerts once the grace window elapses with still no heartbeat', async () => {
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      now: isoMinutesAgo(200),
    });
    const approvedAt = isoMinutesAgo(200);
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', approvedAt);
    // Still no touchHeartbeat call.

    const config = {
      discordAlertsWebhookUrl: 'https://discord.test/webhook',
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
    } as const;

    // Grace window is 60 * 2 = 120 minutes; approvedAt was 200 minutes ago,
    // well past it.
    await runOfflineCheck(repository, config as never, new Date());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(repository.getServer(SERVER_ID)!.offline_alerted_at).not.toBeNull();
  });
});

// D6 (Wave 2 hardening): scheduleOfflineMonitor's re-entrancy guard. A tick
// that fires while the previous run's promise is still pending must be
// skipped, not run concurrently.
describe('scheduleOfflineMonitor single-flight guard (D6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('skips a tick that fires while the previous check is still in flight', async () => {
    vi.useFakeTimers();
    const repository = new OperationsRepository(openDb(':memory:'));
    repository.upsertPendingServer({
      id: SERVER_ID,
      institutionCode: '01234567',
      productType: 'LIMS',
      hostname: 'HOUSE-LIMS-01',
      now: isoMinutesAgo(1000),
    });
    repository.approveServer(SERVER_ID, 'plain-key', 'hash', isoMinutesAgo(1000));
    repository.touchHeartbeat(SERVER_ID, isoMinutesAgo(1000), undefined);

    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(new Response(null, { status: 204 }));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Interval well under discordAlerts.ts's 10s request timeout, so the
    // abort timer can't fire mid-test and free up the in-flight flag on
    // its own before we assert the guard skipped the second tick.
    const config = {
      discordAlertsWebhookUrl: 'https://discord.test/webhook',
      heartbeatExpectedIntervalMinutes: 60,
      heartbeatMissedThreshold: 2,
      offlineCheckIntervalMinutes: 0.1, // 6s
    } as const;

    const timer = scheduleOfflineMonitor(repository, config as never);
    try {
      // The initial run() call fires synchronously; its fetch is still
      // pending (we haven't resolved it yet).
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance past one full interval while the first run is still
      // in-flight — the tick should be skipped, not started concurrently.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping this tick'));

      // Let the first run finish, then confirm a later tick behaves
      // normally again (guard only blocks genuine overlap).
      resolveFetch?.();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      clearInterval(timer);
      warnSpy.mockRestore();
    }
  });
});
