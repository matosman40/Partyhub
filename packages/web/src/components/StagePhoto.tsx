import type { CSSProperties } from 'react';

/**
 * Photo d'ambiance de l'écran principal, sous le contenu. Le voile sombre est peint dans le même fond : sans image
 * (404, hors ligne), il reste un aplat sombre et la scène dessinée en dessous reste visible. `variant` règle la force
 * du voile : le salon et la partie ont du texte posé dessus, la fin de partie un peu moins.
 */
export function StagePhoto({ url, variant = 'game' }: { url: string; variant?: 'lobby' | 'game' | 'end' }) {
  return (
    <div
      className={`stage-photo is-${variant}`}
      aria-hidden="true"
      style={{ '--photo': `url("${url}")` } as CSSProperties}
    />
  );
}
