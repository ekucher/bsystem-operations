import { IconMoon, IconSun } from '../icons';
import type { Theme } from '../useTheme';

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
  className?: string;
}

export default function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      onClick={onToggle}
      aria-label="Перемкнути тему"
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}
