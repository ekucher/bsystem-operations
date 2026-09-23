import { sendDiscordAlert } from './discordAlerts.js';
import { isServerOnline } from './serverStatus.js';
import type { OperationsRepository, ServerRow } from './repository.js';
import type { AppConfig } from './config.js';

// Etap 4 (grilling: offline-детекція -> наявний Discord alerts-канал, не
// нова інфраструктура сповіщень). Pure function so the transition logic
// (who newly went offline, who just recovered) is testable without a DB
// or a network call — mirrors serverStatus.ts's isServerOnline() split.
export interface OfflineTransition {
  server: ServerRow;
  kind: 'went-offline' | 'recovered';
}

export function computeOfflineTransitions(
  servers: ServerRow[],
  now: Date,
  expectedIntervalMinutes: number,
  missedThreshold: number,
): OfflineTransition[] {
  const transitions: OfflineTransition[] = [];
  for (const server of servers) {
    // Only approved servers were ever actually reporting heartbeats — a
    // still-pending enrollment isn't "offline", it's just not onboarded
    // yet, and must not trigger an alert.
    if (server.status !== 'approved') {
      continue;
    }
    const online = isServerOnline(server, now, expectedIntervalMinutes, missedThreshold);
    if (!online && !server.offline_alerted_at) {
      transitions.push({ server, kind: 'went-offline' });
    } else if (online && server.offline_alerted_at) {
      transitions.push({ server, kind: 'recovered' });
    }
  }
  return transitions;
}

export function formatOfflineMessage(server: ServerRow): string {
  const lastHeartbeat = server.last_heartbeat_at ?? 'ніколи';
  return `:warning: **${server.hostname}** (${server.institution_code}) офлайн. Останній heartbeat: ${lastHeartbeat}.`;
}

export function formatRecoveryMessage(server: ServerRow): string {
  return `:white_check_mark: **${server.hostname}** (${server.institution_code}) знову онлайн.`;
}

// Alert failures (Discord webhook down, network hiccup) must not corrupt
// the dedup marker — if we failed to actually notify, the next tick
// should retry rather than silently give up, so the marker is only
// written/cleared after a successful send.
export async function runOfflineCheck(repository: OperationsRepository, config: AppConfig, now: Date): Promise<void> {
  if (!config.discordAlertsWebhookUrl) {
    return;
  }
  const webhookUrl = config.discordAlertsWebhookUrl;
  const servers = repository.listServers();
  const transitions = computeOfflineTransitions(servers, now, config.heartbeatExpectedIntervalMinutes, config.heartbeatMissedThreshold);
  for (const transition of transitions) {
    try {
      if (transition.kind === 'went-offline') {
        await sendDiscordAlert(webhookUrl, formatOfflineMessage(transition.server));
        repository.markOfflineAlerted(transition.server.id, now.toISOString());
      } else {
        await sendDiscordAlert(webhookUrl, formatRecoveryMessage(transition.server));
        repository.clearOfflineAlert(transition.server.id);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`offlineMonitor: failed to send Discord alert for server ${transition.server.id}`, err);
    }
  }
}

export function scheduleOfflineMonitor(repository: OperationsRepository, config: AppConfig): NodeJS.Timeout | undefined {
  if (!config.discordAlertsWebhookUrl) {
    // eslint-disable-next-line no-console
    console.warn('DISCORD_ALERTS_WEBHOOK_URL not set — offline alerting is disabled.');
    return undefined;
  }
  const intervalMs = config.offlineCheckIntervalMinutes * 60_000;
  const run = (): void => {
    runOfflineCheck(repository, config, new Date()).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('offlineMonitor: check run failed', err);
    });
  };
  run();
  return setInterval(run, intervalMs);
}
