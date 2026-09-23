import { useEffect, useState } from 'react';
import { logout, me } from './api';
import LoginPage from './components/LoginPage';
import OverviewPage from './components/OverviewPage';
import ServerDetailPage from './components/ServerDetailPage';
import type { AuthUser } from './types';

type View = { name: 'overview' } | { name: 'detail'; serverId: string };

// No router dependency: the app has exactly three screens (login,
// overview, detail) and the detail screen only ever comes from clicking
// a row in overview — a full router would add a dependency for
// navigation this small state machine already covers.
export default function App() {
  const [authState, setAuthState] = useState<'checking' | 'anonymous' | 'authenticated'>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<View>({ name: 'overview' });

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
      <main>
        <p>Завантаження...</p>
      </main>
    );
  }

  if (authState === 'anonymous' || !user) {
    return <LoginPage onLoggedIn={handleLoggedIn} />;
  }

  return (
    <main>
      <header className="app-header">
        <h1>BSYSTEM Operations</h1>
        <div className="app-header-user">
          <span>
            {user.username} ({user.role})
          </span>
          <button type="button" onClick={handleLogout}>
            Вийти
          </button>
        </div>
      </header>
      {view.name === 'overview' ? (
        <OverviewPage user={user} onOpenServer={(serverId) => setView({ name: 'detail', serverId })} />
      ) : (
        <ServerDetailPage serverId={view.serverId} onBack={() => setView({ name: 'overview' })} />
      )}
    </main>
  );
}
