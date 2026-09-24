import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, approveServer, listServers } from '../api';
import { IconCritical, IconPending, IconRack, IconRefresh, IconSkipped, IconSuccess, IconWarning, TierIcon } from '../icons';
import {
  CATEGORY_LABELS,
  NEVER_HEARTBEAT_LABEL,
  onlineLabel,
  onlineTier,
  pillClassForTier,
  serverStatusLabel,
  serverStatusPillClass,
  serverStatusTier,
  severityLabel,
  severityTier,
} from '../labels';
import { computeStaleLevel, type HeartbeatConfig } from '../staleness';
import type { AuthUser, ServerSummary, Severity } from '../types';

interface OverviewPageProps {
  user: AuthUser;
  onOpenServer: (serverId: string) => void;
  onHeartbeatConfig: (config: HeartbeatConfig) => void;
}

type SortKey = 'hostname' | 'institution_code' | 'product_type' | 'status' | 'last_heartbeat_at';
type StatusFilter = 'all' | 'pending' | 'approved' | 'revoked';
type CategoryFilter = 'all' | Severity | 'none';

const POLL_INTERVAL_MS = 30_000;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('uk-UA');
}

function matchesCategoryFilter(entrySeverity: Severity | undefined, filter: CategoryFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'none') {
    return !entrySeverity;
  }
  return entrySeverity === filter;
}

export default function OverviewPage({ user, onOpenServer, onHeartbeatConfig }: OverviewPageProps) {
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('hostname');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [productFilter, setProductFilter] = useState<'all' | 'LIMS' | 'VETOFFICE'>('all');
  const [backupFilter, setBackupFilter] = useState<CategoryFilter>('all');
  const [maintenanceFilter, setMaintenanceFilter] = useState<CategoryFilter>('all');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [heartbeatConfig, setHeartbeatConfigState] = useState<HeartbeatConfig | null>(null);

  const refresh = useCallback(() => {
    listServers()
      .then((res) => {
        setServers(res.servers);
        setError(null);
        const config: HeartbeatConfig = {
          expectedMinutes: res.heartbeatExpectedIntervalMinutes,
          missedThreshold: res.heartbeatMissedThreshold,
        };
        setHeartbeatConfigState(config);
        onHeartbeatConfig(config);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Не вдалося завантажити список серверів.');
      });
  }, [onHeartbeatConfig]);

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
      .filter((s) => matchesCategoryFilter(s.latestByCategory.backup?.severity, backupFilter))
      .filter((s) => matchesCategoryFilter(s.latestByCategory.maintenance?.severity, maintenanceFilter))
      .slice()
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        return String(av).localeCompare(String(bv), 'uk');
      });
  }, [servers, sortKey, statusFilter, productFilter, backupFilter, maintenanceFilter]);

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
      <div className="page-head">
        <div>
          <h1>Огляд</h1>
          <p className="meta">{servers ? `${servers.length} серверів під наглядом` : 'Завантаження...'} · оновлюється кожні 30 секунд</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-icon neutral">
            <IconRack />
          </span>
          <div>
            <div className="stat-value">{counters.total}</div>
            <div className="stat-label">усього</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon online">
            <IconSuccess />
          </span>
          <div>
            <div className="stat-value">{counters.online}</div>
            <div className="stat-label">онлайн</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon offline">
            <IconSkipped />
          </span>
          <div>
            <div className="stat-value">{counters.offline}</div>
            <div className="stat-label">офлайн</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon pending">
            <IconPending />
          </span>
          <div>
            <div className="stat-value">{counters.pending}</div>
            <div className="stat-label">очікують підтвердження</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon critical">
            <IconCritical />
          </span>
          <div>
            <div className="stat-value">{counters.critical}</div>
            <div className="stat-label">критичні</div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="field-inline">
          <label htmlFor="sort-select">Сортування</label>
          <select id="sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="hostname">Хост</option>
            <option value="institution_code">Установа</option>
            <option value="product_type">Продукт</option>
            <option value="status">Статус</option>
            <option value="last_heartbeat_at">Останній контакт</option>
          </select>
        </div>
        <div className="field-inline">
          <label htmlFor="status-select">Статус</label>
          <select id="status-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">усі</option>
            <option value="pending">очікують</option>
            <option value="approved">підтверджені</option>
            <option value="revoked">відкликані</option>
          </select>
        </div>
        <div className="field-inline">
          <label htmlFor="product-select">Продукт</label>
          <select
            id="product-select"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value as 'all' | 'LIMS' | 'VETOFFICE')}
          >
            <option value="all">усі</option>
            <option value="LIMS">LIMS</option>
            <option value="VETOFFICE">VetOffice</option>
          </select>
        </div>
        <div className="field-inline">
          <label htmlFor="backup-select">{CATEGORY_LABELS.backup}</label>
          <select id="backup-select" value={backupFilter} onChange={(e) => setBackupFilter(e.target.value as CategoryFilter)}>
            <option value="all">усі</option>
            <option value="SUCCESS">успішно</option>
            <option value="WARNING">попередження</option>
            <option value="ERROR">помилка</option>
            <option value="CRITICAL">критично</option>
            <option value="none">немає даних</option>
          </select>
        </div>
        <div className="field-inline">
          <label htmlFor="maintenance-select">{CATEGORY_LABELS.maintenance}</label>
          <select
            id="maintenance-select"
            value={maintenanceFilter}
            onChange={(e) => setMaintenanceFilter(e.target.value as CategoryFilter)}
          >
            <option value="all">усі</option>
            <option value="SUCCESS">успішно</option>
            <option value="WARNING">попередження</option>
            <option value="ERROR">помилка</option>
            <option value="CRITICAL">критично</option>
            <option value="none">немає даних</option>
          </select>
        </div>
        <button type="button" className="btn" onClick={refresh}>
          <IconRefresh />
          Оновити зараз
        </button>
      </div>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <div className="table-card">
        <div className="table-wrap">
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
                <th>
                  <span className="visually-hidden">Дії</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((server) => {
                const staleLevel =
                  server.status === 'approved'
                    ? computeStaleLevel(server.last_heartbeat_at, server.isOnline, heartbeatConfig)
                    : 'ok';
                return (
                  <tr key={server.id}>
                    <td>
                      <button type="button" className="host-link" onClick={() => onOpenServer(server.id)}>
                        {server.hostname}
                      </button>
                      <div className="institution">{server.institution_code}</div>
                    </td>
                    <td>{server.product_type}</td>
                    <td>
                      <div className="pill-stack">
                        <span className={`pill pill-${serverStatusPillClass(server.status)}`}>
                          <TierIcon tier={serverStatusTier(server.status)} />
                          {serverStatusLabel(server.status)}
                        </span>
                        {server.status === 'approved' && (
                          <span className={`pill pill-${server.isOnline ? 'success' : 'offline'}`}>
                            <TierIcon tier={onlineTier(server.isOnline)} />
                            {onlineLabel(server.isOnline)}
                          </span>
                        )}
                      </div>
                    </td>
                    {(['backup', 'maintenance', 'health'] as const).map((category) => {
                      const entry = server.latestByCategory[category];
                      const tier = severityTier(entry?.severity);
                      return (
                        <td key={category}>
                          {entry ? (
                            <span className={`pill pill-${pillClassForTier(tier)}`}>
                              <TierIcon tier={tier} />
                              {severityLabel(entry.severity)}
                            </span>
                          ) : (
                            <span className="pill pill-neutral">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="cell-meta">
                      {staleLevel === 'ok' ? (
                        formatTimestamp(server.last_heartbeat_at)
                      ) : staleLevel === 'never' ? (
                        <span className="stale-never" title="Сервер підтверджено, але жодного heartbeat від нього ще не надходило">
                          <IconWarning />
                          {NEVER_HEARTBEAT_LABEL}
                        </span>
                      ) : (
                        <span
                          className={staleLevel === 'critical' ? 'stale-critical' : 'stale-warn'}
                          title="Сервер не виходить на зв'язок довше очікуваного heartbeat-інтервалу"
                        >
                          {staleLevel === 'critical' ? <IconCritical /> : <IconWarning />}
                          {formatTimestamp(server.last_heartbeat_at)}
                        </span>
                      )}
                    </td>
                    <td>
                      {server.status === 'pending' && user.role === 'admin' && (
                        <button
                          type="button"
                          className="btn"
                          disabled={approvingId === server.id}
                          onClick={() => handleApprove(server.id)}
                        >
                          {approvingId === server.id ? 'Підтвердження...' : 'Підтвердити'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {servers && filtered.length === 0 && (
                <tr>
                  <td colSpan={8}>Немає серверів, що відповідають фільтру.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!servers && !error && <p className="muted">Завантаження...</p>}
    </section>
  );
}

