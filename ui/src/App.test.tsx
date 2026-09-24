import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface MockState {
  loggedIn: boolean;
}

function installFetchMock(state: MockState): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/v1/auth/me') {
        return state.loggedIn ? jsonResponse({ username: 'admin', role: 'admin' }) : jsonResponse({ error: 'unauthorized' }, 401);
      }
      if (url === '/api/v1/auth/login' && method === 'POST') {
        state.loggedIn = true;
        return jsonResponse({ username: 'admin', role: 'admin' });
      }
      if (url === '/api/v1/auth/logout' && method === 'POST') {
        state.loggedIn = false;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/v1/admin/servers') {
        return jsonResponse({
          servers: [
            {
              id: SERVER_ID,
              institution_code: '01234567',
              product_type: 'LIMS',
              hostname: 'HOUSE-LIMS-01',
              status: 'approved',
              bravo_version: '5.3.0',
              created_at: '2026-09-01T00:00:00.000Z',
              approved_at: '2026-09-01T00:00:00.000Z',
              last_seen_at: '2026-09-23T00:00:00.000Z',
              last_heartbeat_at: '2026-09-23T00:00:00.000Z',
              isOnline: true,
              latestByCategory: {
                backup: { severity: 'SUCCESS', createdAt: '2026-09-23T00:00:00.000Z', payload: { message: 'OK' } },
              },
            },
          ],
          heartbeatExpectedIntervalMinutes: 60,
          heartbeatMissedThreshold: 2,
        });
      }
      if (url === `/api/v1/admin/servers/${SERVER_ID}`) {
        return jsonResponse({
          server: {
            id: SERVER_ID,
            institution_code: '01234567',
            product_type: 'LIMS',
            hostname: 'HOUSE-LIMS-01',
            status: 'approved',
            bravo_version: '5.3.0',
            created_at: '2026-09-01T00:00:00.000Z',
            approved_at: '2026-09-01T00:00:00.000Z',
            last_seen_at: '2026-09-23T00:00:00.000Z',
            last_heartbeat_at: '2026-09-23T00:00:00.000Z',
            isOnline: true,
          },
          latestByCategory: {
            backup: { severity: 'SUCCESS', createdAt: '2026-09-23T00:00:00.000Z', payload: { message: 'архів OK' } },
          },
          events: [
            {
              id: 1,
              server_id: SERVER_ID,
              category: 'backup',
              severity: 'SUCCESS',
              payload: JSON.stringify({ message: 'архів OK' }),
              created_at: '2026-09-23T00:00:00.000Z',
            },
          ],
        });
      }
      throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    }),
  );
}

describe('App', () => {
  let state: MockState;

  beforeEach(() => {
    state = { loggedIn: false };
    installFetchMock(state);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the login page when there is no session', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'BSYSTEM Operations' })).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Логін')).toBeInTheDocument();
  });

  it('logs in and shows the overview with the server from the mock API', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Логін')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Логін'), 'admin');
    await user.type(screen.getByLabelText('Пароль'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Увійти' }));

    await waitFor(() => {
      expect(screen.getByText('HOUSE-LIMS-01')).toBeInTheDocument();
    });
    expect(screen.getByText(/admin \(admin\)/)).toBeInTheDocument();
  });

  it('navigates to the server detail page and back', async () => {
    state.loggedIn = true;
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByText('HOUSE-LIMS-01'));
    await user.click(screen.getByText('HOUSE-LIMS-01'));

    await waitFor(() => {
      // "архів OK" з'являється і в картці "Поточний стан", і в "Історії
      // подій" (той самий останній backup-event) — звужуємо пошук до
      // списку подій, щоб уникнути колізії з двома збігами.
      expect(within(screen.getByRole('list')).getByText('архів OK')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Назад до списку' }));
    await waitFor(() => expect(screen.getByText('HOUSE-LIMS-01')).toBeInTheDocument());
  });

  it('logs out back to the login page', async () => {
    state.loggedIn = true;
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByText('HOUSE-LIMS-01'));
    await user.click(screen.getByRole('button', { name: 'Вийти' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Логін')).toBeInTheDocument();
    });
  });

  it('shows polling copy that matches the actual 30s refresh interval (F4)', async () => {
    state.loggedIn = true;
    render(<App />);

    await waitFor(() => screen.getByText('HOUSE-LIMS-01'));
    expect(screen.getByText(/оновлюється кожні 30 секунд/)).toBeInTheDocument();
  });

  it('shows a distinct label for an approved server that never heartbeated instead of "ok" (F1b)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/v1/auth/me') {
          return jsonResponse({ username: 'admin', role: 'admin' });
        }
        if (url === '/api/v1/admin/servers') {
          return jsonResponse({
            servers: [
              {
                id: SERVER_ID,
                institution_code: '01234567',
                product_type: 'LIMS',
                hostname: 'NEVER-SEEN-01',
                status: 'approved',
                bravo_version: null,
                created_at: '2026-09-01T00:00:00.000Z',
                approved_at: '2026-09-01T00:00:00.000Z',
                last_seen_at: null,
                last_heartbeat_at: null,
                isOnline: false,
                latestByCategory: {},
              },
            ],
            heartbeatExpectedIntervalMinutes: 60,
            heartbeatMissedThreshold: 2,
          });
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
      }),
    );

    render(<App />);

    await waitFor(() => screen.getByText('NEVER-SEEN-01'));
    expect(screen.getByText('ще не було сигналу')).toBeInTheDocument();
  });

  it('renders event history without throwing when a stages payload is malformed (F1a)', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/v1/auth/me') {
          return jsonResponse({ username: 'admin', role: 'admin' });
        }
        if (url === '/api/v1/admin/servers') {
          return jsonResponse({
            servers: [
              {
                id: SERVER_ID,
                institution_code: '01234567',
                product_type: 'LIMS',
                hostname: 'HOUSE-LIMS-01',
                status: 'approved',
                bravo_version: '5.3.0',
                created_at: '2026-09-01T00:00:00.000Z',
                approved_at: '2026-09-01T00:00:00.000Z',
                last_seen_at: '2026-09-23T00:00:00.000Z',
                last_heartbeat_at: '2026-09-23T00:00:00.000Z',
                isOnline: true,
                latestByCategory: {},
              },
            ],
            heartbeatExpectedIntervalMinutes: 60,
            heartbeatMissedThreshold: 2,
          });
        }
        if (url === `/api/v1/admin/servers/${SERVER_ID}`) {
          return jsonResponse({
            server: {
              id: SERVER_ID,
              institution_code: '01234567',
              product_type: 'LIMS',
              hostname: 'HOUSE-LIMS-01',
              status: 'approved',
              bravo_version: '5.3.0',
              created_at: '2026-09-01T00:00:00.000Z',
              approved_at: '2026-09-01T00:00:00.000Z',
              last_seen_at: '2026-09-23T00:00:00.000Z',
              last_heartbeat_at: '2026-09-23T00:00:00.000Z',
              isOnline: true,
            },
            latestByCategory: {},
            events: [
              {
                id: 1,
                server_id: SERVER_ID,
                category: 'backup',
                severity: 'WARNING',
                payload: JSON.stringify({ message: 'подія з рядком замість масиву', details: { stages: 'not-an-array' } }),
                created_at: '2026-09-23T00:00:00.000Z',
              },
              {
                id: 2,
                server_id: SERVER_ID,
                category: 'maintenance',
                severity: 'ERROR',
                payload: JSON.stringify({
                  message: 'подія з частково зіпсованими етапами',
                  details: {
                    stages: [{ name: 'ok-stage', status: 'OK' }, { status: 'ERROR' }, 'not-an-object', 42],
                  },
                }),
                created_at: '2026-09-23T00:01:00.000Z',
              },
            ],
          });
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
      }),
    );

    render(<App />);
    await waitFor(() => screen.getByText('HOUSE-LIMS-01'));
    await user.click(screen.getByText('HOUSE-LIMS-01'));

    // Both malformed events render without throwing.
    await waitFor(() => screen.getByText('подія з рядком замість масиву'));
    expect(screen.getByText('подія з частково зіпсованими етапами')).toBeInTheDocument();

    // Expanding the second event shows the one valid stage and a note that
    // the rest were skipped, instead of crashing.
    await user.click(screen.getByText('подія з частково зіпсованими етапами'));
    await waitFor(() => screen.getByText('ok-stage'));
    expect(screen.getByText(/не вдалося розпізнати/)).toBeInTheDocument();
  });

  it('returns to the login page with a session-expired notice on a 401 during a background refresh (F3)', async () => {
    const user = userEvent.setup();
    let serversCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/v1/auth/me') {
          return jsonResponse({ username: 'admin', role: 'admin' });
        }
        if (url === '/api/v1/admin/servers') {
          serversCallCount += 1;
          if (serversCallCount > 1) {
            return jsonResponse({ error: 'unauthorized' }, 401);
          }
          return jsonResponse({
            servers: [
              {
                id: SERVER_ID,
                institution_code: '01234567',
                product_type: 'LIMS',
                hostname: 'HOUSE-LIMS-01',
                status: 'approved',
                bravo_version: '5.3.0',
                created_at: '2026-09-01T00:00:00.000Z',
                approved_at: '2026-09-01T00:00:00.000Z',
                last_seen_at: '2026-09-23T00:00:00.000Z',
                last_heartbeat_at: '2026-09-23T00:00:00.000Z',
                isOnline: true,
                latestByCategory: {},
              },
            ],
            heartbeatExpectedIntervalMinutes: 60,
            heartbeatMissedThreshold: 2,
          });
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
      }),
    );

    render(<App />);
    await waitFor(() => screen.getByText('HOUSE-LIMS-01'));

    // Simulates the session cookie dying server-side mid-session: the next
    // refresh (here triggered manually, standing in for the 30s poll)
    // comes back 401 even though the app still believes it's authenticated.
    await user.click(screen.getByRole('button', { name: 'Оновити зараз' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Логін')).toBeInTheDocument();
    });
    expect(screen.getByText(/Сесія закінчилась/)).toBeInTheDocument();
  });
});
