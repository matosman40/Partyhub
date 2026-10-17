import { useState } from 'react';
import type { SoloBoardProps } from './SoloPlayer.js';

interface TaquinPublic {
  size: number;
  tiles: number[];
}

/** Taquin : seule une tuile voisine de la case vide peut glisser dedans. */
export function TaquinView({ board, disabled, send }: SoloBoardProps) {
  const view = board as TaquinPublic;
  const [error, setError] = useState<string | null>(null);
  const blank = view.tiles.indexOf(0);
  const size = view.size;

  function neighbours(i: number): boolean {
    const r = Math.floor(i / size);
    const c = i % size;
    const br = Math.floor(blank / size);
    const bc = blank % size;
    return Math.abs(r - br) + Math.abs(c - bc) === 1;
  }

  async function slide(index: number) {
    if (disabled || index === blank || !neighbours(index)) return;
    setError(null);
    const res = await send('play', { index });
    if (!res.ok) setError(res.error ?? 'Coup refusé');
  }

  return (
    <div className="solo-taquin">
      <div
        className="solo-taquin-grid"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        role="group"
        aria-label="Taquin"
      >
        {view.tiles.map((value, i) => {
          const movable = value !== 0 && !disabled && neighbours(i);
          return (
            <button
              key={i}
              type="button"
              className={`solo-tile ${value === 0 ? 'is-blank' : ''} ${movable ? 'is-movable' : ''}`}
              disabled={disabled || value === 0}
              aria-label={value === 0 ? 'Case vide' : `Tuile ${value}`}
              onClick={() => slide(i)}
            >
              {value !== 0 ? value : ''}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
