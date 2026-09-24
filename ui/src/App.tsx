import { useEffect, useState } from 'react';
import { logout, me } from './api';
import LoginPage from './components/LoginPage';
import OverviewPage from './components/OverviewPage';
import ServerDetailPage from './components/ServerDetailPage';
import ThemeToggle from './components/ThemeToggle';
import { IconRack } from './icons';
import type { HeartbeatConfig } from './staleness';
import type { AuthUser } from './types';
import { useTheme } from './useTheme';

type View = { name: 'overview' } | { name: 'detail'; serverId: string };

// No router dependency: the app has exactly three screens (login,
// overview, detail) and the detail screen only ever comes from clicking
// a row in overview — a full router would add a dependency for
// navigation this small state machine already covers.
export default function App() {
  const [authState, setAuthState] = useState<'checking' | 'anonymous' | 'authenticated'>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<View>({ name: 'overview' });
  const [heartbeatConfig, setHeartbeatConfig] = useState<HeartbeatConfig | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    me()
      .then((u) => {
        setUser(u);
        setAuthState('authenticated');
      })
      .catch(() => setAuthState('anonymous'));
  }, []);

  const handleLoggedIn = (loggedInUser: AuthUser): void => {
    setUser(loggedInUser);
    setAuthState('authenticated');
    setView({ name: 'overview' });
  };

  const handleLogout = (): void => {
    logout()
      .catch(() => undefined)
      .finally(() => {
        setUser(null);
        setAuthState('anonymous');
      });
  };

  if (authState === 'checking') {
    return (
      <main className="login-page">
        <p>Завантаження...</p>
      </main>
    );
  }

  if (authState === 'anonymous' || !user) {
    return <LoginPage onLoggedIn={handleLoggedIn} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <IconRack />
          </span>
          BSYSTEM Operations
        </div>
        <div className="header-right">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="user-chip">
            <span className="user-avatar">{user.username.charAt(0).toUpperCase()}</span>
            {user.username} ({user.role})
          </div>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            Вийти
          </button>
        </div>
      </header>
      <main className="app-main">
        {view.name === 'overview' ? (
          <OverviewPage
            user={user}
            onOpenServer={(serverId) => setView({ name: 'detail', serverId })}
            onHeartbeatConfig={setHeartbeatConfig}
          />
        ) : (
          <ServerDetailPage
            serverId={view.serverId}
            onBack={() => setView({ name: 'overview' })}
            heartbeatConfig={heartbeatConfig}
          />
        )}
      </main>
    </div>
  );
}
