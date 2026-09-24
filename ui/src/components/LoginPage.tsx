import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, login } from '../api';
import { IconLock, IconRack } from '../icons';
import type { AuthUser } from '../types';
import ThemeToggle from './ThemeToggle';
import type { Theme } from '../useTheme';

interface LoginPageProps {
  onLoggedIn: (user: AuthUser) => void;
  theme: Theme;
  onToggleTheme: () => void;
  notice?: string | null;
}

export default function LoginPage({ onLoggedIn, theme, onToggleTheme, notice }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    login(username, password)
      .then(onLoggedIn)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          setError('Невірний логін або пароль.');
        } else {
          setError('Не вдалося увійти. Спробуйте пізніше.');
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="login-page">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="login-theme-toggle" />
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-mark">
          <IconRack />
        </div>
        <h1>BSYSTEM Operations</h1>
        <p className="sub">Моніторинг серверів LIMS / VetOffice</p>
        {notice && (
          <p role="status" className="form-notice">
            {notice}
          </p>
        )}
        <div className="field">
          <label htmlFor="username">Логін</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary full" disabled={submitting}>
          <IconLock />
          {submitting ? 'Вхід...' : 'Увійти'}
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <p className="login-foot">Доступ лише для уповноважених операторів</p>
      </form>
    </main>
  );
}
