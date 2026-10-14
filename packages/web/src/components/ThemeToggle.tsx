import { useState } from 'react';
import { applyTheme, loadTheme, saveTheme, type ThemeName } from '../theme/index.js';

/** Bouton clair/sombre. La préférence est retenue sur l'appareil. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());

  function toggle() {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  }

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? 'Passer au thème clair' : 'Passer au thème sombre'}
      title={isDark ? 'Thème clair' : 'Thème sombre'}
    >
      <span aria-hidden="true">{isDark ? '☀️' : '🌙'}</span>
    </button>
  );
}
