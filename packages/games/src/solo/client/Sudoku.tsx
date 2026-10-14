import { useEffect, useState } from 'react';
import type { SoloBoardProps } from './SoloPlayer.js';

interface SudokuPublic {
  givens: number[];
  grid: number[];
  conflicts: number[];
}

const BLOCK = (i: number) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

/** Grille 9×9 du téléphone : on touche une case, puis un chiffre (pavé ou clavier). */
export function SudokuView({ board, disabled, send }: SoloBoardProps) {
  const view = board as SudokuPublic;
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function put(value: number) {
    if (disabled || selected === null || view.givens[selected] !== 0) return;
    setError(null);
    const res = await send('play', { index: selected, value });
    if (!res.ok) setError(res.error ?? 'Coup refusé');
  }

  // Clavier (tablette, ordinateur) : chiffres, effacer, flèches pour se déplacer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selected === null) return;
      if (/^[1-9]$/.test(e.key)) void put(Number(e.key));
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') void put(0);
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const r = Math.floor(selected / 9);
        const c = selected % 9;
        const next =
          e.key === 'ArrowUp' ? (r > 0 ? selected - 9 : selected)
          : e.key === 'ArrowDown' ? (r < 8 ? selected + 9 : selected)
          : e.key === 'ArrowLeft' ? (c > 0 ? selected - 1 : selected)
          : c < 8 ? selected + 1 : selected;
        setSelected(next);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, disabled, view]);

  const selRow = selected === null ? -1 : Math.floor(selected / 9);
  const selCol = selected === null ? -1 : selected % 9;
  const selBlock = selected === null ? -1 : BLOCK(selected);
  const conflicts = new Set(view.conflicts);

  return (
    <div className="solo-sudoku">
      <div className="solo-sudoku-grid" role="grid" aria-label="Grille de sudoku">
        {view.grid.map((value, i) => {
          const r = Math.floor(i / 9);
          const c = i % 9;
          const given = view.givens[i] !== 0;
          const peer = selected !== null && (r === selRow || c === selCol || BLOCK(i) === selBlock);
          const classes = [
            'solo-cell',
            given ? 'is-given' : '',
            conflicts.has(i) ? 'is-conflict' : '',
            i === selected ? 'is-selected' : peer ? 'is-peer' : '',
            c === 2 || c === 5 ? 'is-block-right' : '',
            r === 2 || r === 5 ? 'is-block-bottom' : '',
          ].join(' ');
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className={classes}
              aria-label={`Ligne ${r + 1}, colonne ${c + 1}${value ? `, ${value}` : ', vide'}`}
              disabled={disabled}
              onClick={() => setSelected(i)}
            >
              {value !== 0 ? value : ''}
            </button>
          );
        })}
      </div>

      <div className="solo-pad" role="group" aria-label="Chiffres">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} type="button" className="btn ghost solo-pad-key" disabled={disabled || selected === null} onClick={() => put(n)}>
            {n}
          </button>
        ))}
        <button type="button" className="btn ghost solo-pad-key is-erase" disabled={disabled || selected === null} onClick={() => put(0)}>
          Effacer
        </button>
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}
