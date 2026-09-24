import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bsystem-ops-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

// Явний вибір оператора (localStorage) переважає системну тему; якщо
// оператор ще не перемикав тему вручну, стежимо за prefers-color-scheme
// живою підпискою, а не одноразовим читанням при монтуванні.
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [override, setOverride] = useState<Theme | null>(() => readStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme: Theme = override ?? (systemDark ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setOverride((current) => {
      const effective = current ?? (systemDark ? 'dark' : 'light');
      const next: Theme = effective === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Приватний режим / вичерпана квота — тема все одно застосується для поточної сесії.
      }
      return next;
    });
  }, [systemDark]);

  return { theme, toggleTheme };
}
