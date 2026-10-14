/**
 * Thèmes visuels. Chaque thème est un jeu de variables CSS déclaré dans styles.css
 * sous [data-theme="<nom>"]. Ajouter un thème = ajouter le bloc CSS et le nom ici.
 */
export const THEMES = ['dark', 'light'] as const;
export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = 'dark';

const STORAGE_KEY = 'ph:theme';

export function applyTheme(name: ThemeName): void {
  document.documentElement.setAttribute('data-theme', name);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', name === 'dark' ? '#08061a' : '#f3efff');
}

/** Préférence mémorisée sur cet appareil ; repli sur le thème par défaut. */
export function loadTheme(): ThemeName {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return (THEMES as readonly string[]).includes(value ?? '') ? (value as ThemeName) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(name: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Stockage indisponible : le thème reste appliqué pour cette page seulement.
  }
}
