import { useCallback, useEffect, useState } from 'react';
import { ApiError, getServer } from '../api';
import type { EventPayload, EventStage, ServerDetail } from '../types';
import { CATEGORY_LABELS } from './OverviewPage';

interface ServerDetailPageProps {
  serverId: string;
  onBack: () => void;
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

export default function ServerDetailPage({ serverId, onBack }: ServerDetailPageProps) {
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
        <button type="button" onClick={onBack}>
          ← Назад до списку
        </button>
        <p role="alert">{error}</p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="server-detail-page">
        <button type="button" onClick={onBack}>
          ← Назад до списку
        </button>
        <p>Завантаження...</p>
      </section>
    );
  }

  const { server, latestByCategory, events } = detail;
  const latestServices = latestByCategory.health?.payload.services ?? [];

  return (
    <section className="server-detail-page">
      <button type="button" onClick={onBack}>
        ← Назад до списку
      </button>
      <h2>
        {server.hostname} <span className="muted">({server.institution_code})</span>
      </h2>
      <p>
        Продукт: <strong>{server.product_type}</strong> · Статус: <strong>{server.status}</strong> ·{' '}
        <span className={server.isOnline ? 'badge badge-online' : 'badge badge-offline'}>
          {server.isOnline ? 'online' : 'offline'}
        </span>
      </p>
      <p className="muted">
        Останній контакт: {formatTimestamp(server.last_heartbeat_at)} · BRAVO {server.bravo_version ?? '?'}
      </p>

      <h3>Поточний стан</h3>
      <div className="category-status-grid">
        {(['backup', 'maintenance', 'health'] as const).map((category) => {
          const entry = latestByCategory[category];
          return (
            <div key={category} className="category-status-card">
              <div className="category-status-title">{CATEGORY_LABELS[category]}</div>
              {entry ? (
                <>
                  <span className={`badge badge-${entry.severity.toLowerCase()}`}>{entry.severity}</span>
                  <p>{entry.payload.message}</p>
                  <p className="muted">{formatTimestamp(entry.createdAt)}</p>
                </>
              ) : (
                <p className="muted">Ще немає подій.</p>
              )}
            </div>
          );
        })}
      </div>

      <h3>Служби</h3>
      {latestServices.length > 0 ? (
        <ul className="service-list">
          {latestServices.map((service) => (
            <li key={service.name}>
              <span className={`badge badge-service-${service.status}`}>{serviceStateLabel(service.status)}</span>{' '}
              {service.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Статус служб ще не отримано.</p>
      )}

      <h3>Історія подій</h3>
      <ul className="event-timeline">
        {events.map((event) => {
          const payload = parsePayload(event.payload);
          const stages = Array.isArray(payload.details?.stages) ? (payload.details!.stages as EventStage[]) : null;
          const otherDetails = payload.details
            ? Object.fromEntries(Object.entries(payload.details).filter(([key]) => key !== 'stages'))
            : null;
          const hasExpandable = Boolean(stages?.length) || Boolean(otherDetails && Object.keys(otherDetails).length > 0);
          return (
            <li key={event.id}>
              <span className={`badge badge-${event.severity.toLowerCase()}`}>{event.severity}</span>{' '}
              <span className="muted">{formatTimestamp(event.created_at)}</span> — {event.category}
              {payload.component ? <span className="muted"> [{payload.component}]</span> : null}: {payload.message}
              {hasExpandable && (
                <details className="event-details">
                  <summary>деталі{stages?.length ? ` (${stages.length} етапів)` : ''}</summary>
                  {stages?.length ? (
                    <ul className="event-stage-list">
                      {stages.map((stage, index) => (
                        <li key={index}>
                          <span className={`badge badge-stage-${stage.status.toLowerCase()}`}>{stage.status}</span>{' '}
                          {stage.name}
                          {typeof stage.durationMs === 'number' ? ` — ${(stage.durationMs / 1000).toFixed(1)}с` : ''}
                          {stage.details ? ` (${stage.details})` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {otherDetails && Object.keys(otherDetails).length > 0 && (
                    <pre className="event-details-json">{JSON.stringify(otherDetails, null, 2)}</pre>
                  )}
                </details>
              )}
            </li>
          );
        })}
        {events.length === 0 && <li className="muted">Історія подій порожня.</li>}
      </ul>
    </section>
  );
}
