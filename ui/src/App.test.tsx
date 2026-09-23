import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'bsystem-operations-api',
            version: '0.1.0',
            timestamp: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the heading and reports API health once loaded', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'BSYSTEM Operations' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/API: ok/)).toBeInTheDocument();
    });
  });
});
