import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, login } from '../api';
import type { AuthUser } from '../types';

interface LoginPageProps {
  onLoggedIn: (user: AuthUser) => void;
}

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
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
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>BSYSTEM Operations</h1>
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
        <button type="submit" disabled={submitting}>
          {submitting ? 'Вхід...' : 'Увійти'}
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
