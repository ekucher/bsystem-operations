import { useCallback, useEffect, useState } from 'react';
import { ApiError, getServer } from '../api';
import { IconChevronLeft, IconChevronRight, IconCritical, IconWarning, TierIcon } from '../icons';
import {
  CATEGORY_LABELS,
  categoryLabel,
  componentLabel,
  detailLabel,
  formatDetailValue,
  onlineLabel,
  onlineTier,
  pillClassForTier,
  serverStatusLabel,
  serverStatusPillClass,
  serverStatusTier,
  severityLabel,
  severityTier,
  stageStatusLabel,
  stageTier,
} from '../labels';
import { computeStaleLevel, type HeartbeatConfig } from '../staleness';
import type { EventPayload, EventStage, ServerDetail } from '../types';

interface ServerDetailPageProps {
  serverId: string;
  onBack: () => void;
  heartbeatConfig: HeartbeatConfig | null;
}

const POLL_INTERVAL_MS = 30_000;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('uk-UA');
}

function parsePayload(raw: string): EventPayload {
  try {
    return JSON.parse(raw) as EventPayload;
  } catch {
    return { message: '(не вдалося розпарсити подію)' };
  }
}

function serviceStateLabel(state: string): string {
  switch (state) {
    case 'running':
      return 'працює';
    case 'stopped':
      return 'зупинена';
    default:
      return 'невідомо';
  }
}

function serviceStateTier(state: string): 'success' | 'critical' | 'pending' {
  switch (state) {
    case 'running':
      return 'success';
    case 'stopped':
      return 'critical';
    default:
      return 'pending';
  }
}

// Кольори тексту/фону задаються через CSS-класи пігулок (success/
// warning/critical/neutral) — токен --neutral-text бракує для 'pending',
// тому іконку служби фарбуємо тим самим маппером, що й саму пігулку.
function serviceCssColorVar(state: string): string {
  return `var(--${pillClassForTier(serviceStateTier(state))}-text)`;
}

export default function ServerDetailPage({ serverId, onBack, heartbeatConfig }: ServerDetailPageProps) {
  const [detail, setDetail] = useState<ServerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getServer(serverId)
      .then((res) => {
        setDetail(res);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Не вдалося завантажити сервер.');
      });
  }, [serverId]);

  useEffect(() => {
    setDetail(null);
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  if (error) {
    return (
      <section className="server-detail-page">
        <button type="button" className="back-link" onClick={onBack}>
          <IconChevronLeft />
          Назад до списку
        </button>
        <p role="alert" className="form-error">
          {error}
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="server-detail-page">
        <button type="button" className="back-link" onClick={onBack}>
          <IconChevronLeft />
          Назад до списку
        </button>
        <p className="muted">Завантаження...</p>
      </section>
    );
  }

  const { server, latestByCategory, events } = detail;
  const latestServices = latestByCategory.health?.payload.services ?? [];
  const staleLevel =
    server.status === 'approved' ? computeStaleLevel(server.last_heartbeat_at, server.isOnline, heartbeatConfig) : 'ok';
  const statusTier = serverStatusTier(server.status);

  return (
    <section className="server-detail-page">
      <button type="button" className="back-link" onClick={onBack}>
        <IconChevronLeft />
        Назад до списку
      </button>

      <div className="page-head">
        <div>
          <h1>
            {server.hostname} <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({server.institution_code})</span>
          </h1>
          <p className="meta">
            Продукт: <strong>{server.product_type}</strong> ·
            <span className={`pill pill-${serverStatusPillClass(server.status)}`}>
              <TierIcon tier={statusTier} />
              {serverStatusLabel(server.status)}
            </span>
            {server.status === 'approved' && (
              <span className={`pill pill-${server.isOnline ? 'success' : 'offline'}`}>
                <TierIcon tier={onlineTier(server.isOnline)} />
                {onlineLabel(server.isOnline)}
              </span>
            )}
            · Останній контакт:{' '}
            {staleLevel === 'ok' ? (
              formatTimestamp(server.last_heartbeat_at)
            ) : (
              <span
                className={staleLevel === 'critical' ? 'stale-critical' : 'stale-warn'}
                title="Сервер не виходить на зв'язок довше очікуваного heartbeat-інтервалу"
              >
                {staleLevel === 'critical' ? <IconCritical /> : <IconWarning />}
                {formatTimestamp(server.last_heartbeat_at)}
              </span>
            )}
            · BRAVO {server.bravo_version ?? '?'}
          </p>
        </div>
      </div>

      <div className="status-grid">
        {(['backup', 'maintenance', 'health'] as const).map((category) => {
          const entry = latestByCategory[category];
          const tier = entry ? severityTier(entry.severity) : 'pending';
          return (
            <div key={category} className="status-card">
              <h3>{CATEGORY_LABELS[category]}</h3>
              {entry ? (
                <>
                  <span className={`pill pill-${pillClassForTier(tier)}`}>
                    <TierIcon tier={tier} />
                    {severityLabel(entry.severity)}
                  </span>
                  <p className="msg">{entry.payload.message}</p>
                  <p className="ts">{formatTimestamp(entry.createdAt)}</p>
                </>
              ) : (
                <p className="muted">Ще немає подій.</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-title">Служби</div>
      {latestServices.length > 0 ? (
        <div className="card">
          {latestServices.map((service) => {
            const tier = serviceStateTier(service.status);
            return (
              <div className="service-row" key={service.name}>
                <TierIcon tier={tier} style={{ color: serviceCssColorVar(service.status) }} />
                <span className="service-name">{service.name}</span>
                <span className={`pill pill-${pillClassForTier(tier)}`}>{serviceStateLabel(service.status)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Статус служб ще не отримано.</p>
      )}

      <div className="section-title">Історія подій</div>
      {events.length > 0 ? (
        <ul className="card event-timeline">
          {events.map((event) => {
            const payload = parsePayload(event.payload);
            const stages = Array.isArray(payload.details?.stages) ? (payload.details!.stages as EventStage[]) : null;
            const otherDetails = payload.details
              ? Object.fromEntries(Object.entries(payload.details).filter(([key]) => key !== 'stages'))
              : {};
            const knownEntries = Object.entries(otherDetails).filter(([key]) => detailLabel(key) !== null);
            const unknownEntries = Object.entries(otherDetails).filter(([key]) => detailLabel(key) === null);
            const hasExpandable = Boolean(stages?.length) || knownEntries.length > 0 || unknownEntries.length > 0;
            const tier = severityTier(event.severity);
            return (
              <li key={event.id} className="event-row">
                {hasExpandable ? (
                  <details>
                    <summary className="event-summary">
                      <span className={`pill pill-${pillClassForTier(tier)}`}>
                        <TierIcon tier={tier} />
                        {severityLabel(event.severity)}
                      </span>
                      <span className="event-time">{formatTimestamp(event.created_at)}</span>
                      <span className="event-cat">{categoryLabel(event.category)}</span>
                      {payload.component ? <span className="event-tag">[{componentLabel(payload.component)}]</span> : null}
                      <span className="event-msg">{payload.message}</span>
                      <IconChevronRight className="icon chev" />
                    </summary>
                    <div className="event-body">
                      {stages?.length ? (
                        <div className="stage-list">
                          {stages.map((stage, index) => {
                            const stageTierValue = stageTier(stage.status);
                            return (
                              <div className="stage-row" key={index}>
                                <span className={`pill pill-${pillClassForTier(stageTierValue)}`}>
                                  <TierIcon tier={stageTierValue} />
                                  {stageStatusLabel(stage.status)}
                                </span>
                                <span className="stage-name">{stage.name}</span>
                                {typeof stage.durationMs === 'number' && (
                                  <span className="stage-duration">{(stage.durationMs / 1000).toFixed(1)} с</span>
                                )}
                                {stage.details ? <span className="stage-note">{stage.details}</span> : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {knownEntries.length > 0 && (
                        <dl className="kv-grid">
                          {knownEntries.map(([key, value]) => (
                            <div className="kv-pair" key={key}>
                              <dt>{detailLabel(key)}</dt>
                              <dd>{formatDetailValue(key, value)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {unknownEntries.length > 0 && (
                        <>
                          <div className="raw-json-label">Інші поля (невідомі)</div>
                          <pre className="raw-json">{JSON.stringify(Object.fromEntries(unknownEntries), null, 2)}</pre>
                        </>
                      )}
                    </div>
                  </details>
                ) : (
                  <div className="event-summary" style={{ cursor: 'default' }}>
                    <span className={`pill pill-${pillClassForTier(tier)}`}>
                      <TierIcon tier={tier} />
                      {severityLabel(event.severity)}
                    </span>
                    <span className="event-time">{formatTimestamp(event.created_at)}</span>
                    <span className="event-cat">{categoryLabel(event.category)}</span>
                    {payload.component ? <span className="event-tag">[{componentLabel(payload.component)}]</span> : null}
                    <span className="event-msg">{payload.message}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Історія подій порожня.</p>
      )}
    </section>
  );
}
