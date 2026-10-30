/** Mise en page de l'interface de l'écran principal (pure) et petits calculs d'affichage. */

export interface HudLayout {
  /** Facteur d'échelle par rapport à 1080 p. */
  k: number;
  /** Taille du texte courant : 28 px à 1080 p, jamais moins de 16 px. */
  font: number;
  /** Taille du chronomètre. */
  fontTimer: number;
  /** Taille du compte à rebours géant. */
  fontBig: number;
  margin: number;
  /** Agrandissement entier des visages (32 px sources). */
  faceScale: number;
  title: { x: number; y: number };
  timer: { cx: number; y: number };
  ranking: { x: number; y: number; w: number; rowH: number; headerH: number; h: number };
}

const BASE_FONT = 28;

export function hudLayout(w: number, h: number, playerCount: number): HudLayout {
  const k = h / 1080;
  const font = Math.max(16, Math.round(BASE_FONT * k));
  const margin = Math.round(24 * k);
  const rowH = Math.round(54 * k);
  const headerH = Math.round(44 * k);
  const rows = Math.max(1, Math.min(8, playerCount));
  const rankW = Math.round(400 * k);
  return {
    k,
    font,
    fontTimer: Math.round(44 * k),
    fontBig: Math.round(280 * k),
    margin,
    faceScale: Math.max(1, Math.round(k)),
    title: { x: margin, y: margin },
    timer: { cx: Math.round(w / 2), y: margin },
    ranking: {
      x: w - margin - rankW,
      y: margin + Math.round(56 * k),
      w: rankW,
      rowH,
      headerH,
      h: headerH + rows * rowH,
    },
  };
}

/** `0:12.3` : minutes, secondes et dixièmes d'un nombre de pas de 1/60 s. */
export function formatTicks(ticks: number): string {
  const total = Math.max(0, ticks) / 60;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const d = Math.floor((total * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/** `42,3 s` : durée d'une course en secondes, à la française. */
export function formatSeconds(ticks: number): string {
  return `${(Math.max(0, ticks) / 60).toFixed(1).replace('.', ',')} s`;
}

export interface Standing {
  id: string;
  x: number;
  finished: boolean;
  rank: number | null;
}

/** Classement en direct : les arrivés dans l'ordre d'arrivée, puis les autres du plus avancé au moins avancé. */
export function liveRanking<T extends Standing>(players: readonly T[]): T[] {
  return players.slice().sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return (a.rank ?? 0) - (b.rank ?? 0);
    return b.x - a.x || a.id.localeCompare(b.id);
  });
}

/** Chiffre du compte à rebours à afficher : 3, 2, 1, puis `GO` pendant une seconde, puis rien. */
export function countdownLabel(msToStart: number): string | null {
  if (msToStart > 2000) return '3';
  if (msToStart > 1000) return '2';
  if (msToStart > 0) return '1';
  if (msToStart > -900) return 'GO !';
  return null;
}

/** Ne garde que le début d'un nom trop long pour tenir au-dessus d'une tête. */
export function shortName(name: string, max = 10): string {
  const chars = Array.from(name.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}
