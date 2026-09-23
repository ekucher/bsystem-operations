import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`API responded ${res.status}`);
        }
        return res.json() as Promise<HealthResponse>;
      })
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <main>
      <h1>BSYSTEM Operations</h1>
      <p>Dashboard v1 — у розробці (Етап 0: foundation).</p>
      {health && (
        <p>
          API: {health.status} (v{health.version})
        </p>
      )}
      {error && <p role="alert">API недоступний: {error}</p>}
    </main>
  );
}
