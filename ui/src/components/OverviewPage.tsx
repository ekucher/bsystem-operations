import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, approveServer, listServers } from '../api';
import type { AuthUser, ServerSummary } from '../types';
import { CATEGORY_LABELS, onlineLabel, serverStatusLabel, severityLabel } from '../labels';

interface OverviewPageProps {
  user: AuthUser;
  onOpenServer: (serverId: string) => void;
}

type SortKey = 'hostname' | 'institution_code' | 'product_type' | 'status' | 'last_heartbeat_at';
type StatusFilter = 'all' | 'pending' | 'approved' | 'revoked';

const POLL_INTERVAL_MS = 30_000;

function severityBadge(severity: string | undefined): string {
  if (!severity) {
    return 'badge badge-unknown';
  }
  return `badge badge-${severity.toLowerCase()}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('uk-UA');
}

export default function OverviewPage({ user, onOpenServer }: OverviewPageProps) {
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('hostname');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [productFilter, setProductFilter] = useState<'all' | 'LIMS' | 'VETOFFICE'>('all');
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listServers()
      .then((res) => {
        setServers(res.servers);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Не вдалося завантажити список серверів.');
      });
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!servers) {
      return [];
    }
    return servers
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .filter((s) => productFilter === 'all' || s.product_type === productFilter)
      .slice()
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        return String(av).localeCompare(String(bv), 'uk');
      });
  }, [servers, sortKey, statusFilter, productFilter]);

  const counters = useMemo(() => {
    if (!servers) {
      return { total: 0, online: 0, offline: 0, pending: 0, critical: 0 };
    }
    return {
      total: servers.length,
      online: servers.filter((s) => s.isOnline).length,
      offline: servers.filter((s) => s.status === 'approved' && !s.isOnline).length,
      pending: servers.filter((s) => s.status === 'pending').length,
      critical: servers.filter((s) =>
        Object.values(s.latestByCategory).some((entry) => entry?.severity === 'CRITICAL'),
      ).length,
    };
  }, [servers]);

  const handleApprove = (serverId: string): void => {
    setApprovingId(serverId);
    approveServer(serverId)
      .then(refresh)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Не вдалося підтвердити сервер.');
      })
      .finally(() => setApprovingId(null));
  };

  return (
    <section className="overview-page">
      <div className="counters">
        <div className="counter">
          <span className="counter-value">{counters.total}</span>
          <span className="counter-label">усього</span>
        </div>
        <div className="counter counter-ok">
          <span className="counter-value">{counters.online}</span>
          <span className="counter-label">онлайн</span>
        </div>
        <div className="counter counter-warn">
          <span className="counter-value">{counters.offline}</span>
          <span className="counter-label">офлайн</span>
        </div>
        <div className="counter">
          <span className="counter-value">{counters.pending}</span>
          <span className="counter-label">очікують підтвердження</span>
        </div>
        <div className="counter counter-critical">
          <span className="counter-value">{counters.critical}</span>
          <span className="counter-label">критичні</span>
        </div>
      </div>

      <div className="filters">
        <label>
          Сортування:
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="hostname">Хост</option>
            <option value="institution_code">Установа</option>
            <option value="product_type">Продукт</option>
            <option value="status">Статус</option>
            <option value="last_heartbeat_at">Останній контакт</option>
          </select>
        </label>
        <label>
          Статус:
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">усі</option>
            <option value="pending">очікують</option>
            <option value="approved">підтверджені</option>
            <option value="revoked">відкликані</option>
          </select>
        </label>
        <label>
          Продукт:
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value as 'all' | 'LIMS' | 'VETOFFICE')}>
            <option value="all">усі</option>
            <option value="LIMS">LIMS</option>
            <option value="VETOFFICE">VetOffice</option>
          </select>
        </label>
        <button type="button" onClick={refresh}>
          Оновити зараз
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      <table className="servers-table">
        <thead>
          <tr>
            <th>Хост / установа</th>
            <th>Продукт</th>
            <th>Статус</th>
            <th>{CATEGORY_LABELS.backup}</th>
            <th>{CATEGORY_LABELS.maintenance}</th>
            <th>{CATEGORY_LABELS.health}</th>
            <th>Останній контакт</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.map((server) => (
            <tr key={server.id}>
              <td>
                <button type="button" className="link-button" onClick={() => onOpenServer(server.id)}>
                  {server.hostname}
                </button>
                <div className="muted">{server.institution_code}</div>
              </td>
              <td>{server.product_type}</td>
              <td>
                <span className={`badge badge-status-${server.status}`}>{serverStatusLabel(server.status)}</span>
                {server.status === 'approved' && (
                  <span className={server.isOnline ? 'badge badge-online' : 'badge badge-offline'}>
                    {onlineLabel(server.isOnline)}
                  </span>
                )}
              </td>
              {(['backup', 'maintenance', 'health'] as const).map((category) => (
                <td key={category}>
                  <span className={severityBadge(server.latestByCategory[category]?.severity)}>
                    {severityLabel(server.latestByCategory[category]?.severity)}
                  </span>
                </td>
              ))}
              <td>{formatTimestamp(server.last_heartbeat_at)}</td>
              <td>
                {server.status === 'pending' && user.role === 'admin' && (
                  <button type="button" disabled={approvingId === server.id} onClick={() => handleApprove(server.id)}>
                    {approvingId === server.id ? 'Підтвердження...' : 'Підтвердити'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {servers && filtered.length === 0 && (
            <tr>
              <td colSpan={8}>Немає серверів, що відповідають фільтру.</td>
            </tr>
          )}
        </tbody>
      </table>
      {!servers && !error && <p>Завантаження...</p>}
    </section>
  );
}
