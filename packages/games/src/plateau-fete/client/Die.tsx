import type { CSSProperties } from 'react';

/**
 * Dé en 3D (CSS) : six faces, orientées pour montrer la valeur demandée. `value` absent : le dé est posé sur une
 * face neutre, en attente. `rolling` joue l’animation de roulis, à chaque nouvelle valeur.
 */

/** Pions de chaque face, sur une grille de 3 × 3 (indices de 0 à 8). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Rotation du cube qui amène chaque face devant le spectateur. */
const TURN: Record<number, readonly [number, number]> = {
  1: [0, 0],
  2: [90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  6: [0, 180],
};

/** Face posée sur chaque côté du cube, dans l’ordre (devant, dessous, droite, gauche, dessus, derrière). */
const FACES = [
  { n: 1, cls: 'front' },
  { n: 2, cls: 'bottom' },
  { n: 3, cls: 'right' },
  { n: 4, cls: 'left' },
  { n: 5, cls: 'top' },
  { n: 6, cls: 'back' },
] as const;

export function Die({
  value,
  rolling = false,
  size = 'md',
  label,
}: {
  value: number | null;
  rolling?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const shown = value ?? 1;
  const [x, y] = TURN[shown] ?? [0, 0];
  const style = { transform: `rotateX(${x}deg) rotateY(${y}deg)` } as CSSProperties;
  return (
    <div
      className={`pf-die pf-die-${size}${rolling ? ' is-rolling' : ''}${value === null ? ' is-waiting' : ''}`}
      role="img"
      aria-label={label ?? (value === null ? 'Dé en attente' : `Dé : ${value}`)}
    >
      <div className="pf-die-cube" style={style}>
        {FACES.map((face) => (
          <span key={face.n} className={`pf-face pf-face-${face.cls}`} aria-hidden="true">
            {value === null ? (
              <span className="pf-face-q">?</span>
            ) : (
              PIPS[face.n]!.map((cell) => (
                <i key={cell} style={{ gridColumn: (cell % 3) + 1, gridRow: Math.floor(cell / 3) + 1 }} />
              ))
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
