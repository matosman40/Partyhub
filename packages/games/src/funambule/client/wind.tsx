import type { CSSProperties } from 'react';

/** Temps en secondes, avec une décimale et la virgule française : « 12,0 s ». */
export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Rubans qui flottent dans le sens du vent : leur longueur suit la force, leur côté le sens. Ce sont eux
 * qui disent le vent, avant les chiffres. `wind` va de -1 (gauche, plein vent) à 1 (droite, plein vent).
 */
export function Streamers({ wind, size = 'lg' }: { wind: number; size?: 'sm' | 'lg' }) {
  const force = Math.min(1, Math.abs(wind));
  const side = wind >= 0 ? 'right' : 'left';
  return (
    <div className={`fnb-streamers is-${size}`} data-side={side} aria-hidden="true">
      {[0, 1, 2, 3].map((row) => {
        const reach = force * (1 - row * 0.16);
        return <span key={row} style={{ '--reach': reach.toFixed(3), '--row': row } as CSSProperties} />;
      })}
    </div>
  );
}

/** Phrase lisible du vent, pour la légende : « Vent vers la droite », « Vent calme »… */
export function windSentence(wind: number): string {
  if (Math.abs(wind) < 0.05) return 'Vent calme';
  return wind > 0 ? 'Vent vers la droite' : 'Vent vers la gauche';
}
