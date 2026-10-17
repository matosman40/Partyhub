import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SoloBoardProps } from './SoloPlayer.js';

interface Clue {
  number: number;
  text: string;
  length: number;
  row: number;
  col: number;
}

interface CrosswordPublic {
  rows: number;
  cols: number;
  black: boolean[];
  numbers: number[];
  letters: string[];
  errors: number[];
  clues: { across: Clue[]; down: Clue[] };
}

/** Une seule lettre A à Z, sans accent : ce qui est tapé est normalisé. */
function toLetter(raw: string): string {
  const letter = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return letter.slice(-1);
}

/** Grille de mots croisés : chaque case blanche accepte une lettre, puis le curseur avance. */
export function CrosswordView({ board, disabled, send }: SoloBoardProps) {
  const view = board as CrosswordPublic;
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [local, setLocal] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Une nouvelle vue du serveur remplace les lettres saisies localement.
  useEffect(() => {
    setLocal({});
  }, [board]);

  const total = view.rows * view.cols;
  const valueOf = (i: number) => (i in local ? local[i]! : (view.letters[i] ?? ''));
  const errors = new Set(view.errors);

  function nextWhite(i: number, step: 1 | -1): number {
    for (let j = i + step; j >= 0 && j < total; j += step) {
      if (!view.black[j]) return j;
    }
    return -1;
  }

  function focus(i: number) {
    if (i >= 0) refs.current[i]?.focus();
  }

  async function write(i: number, letter: string) {
    setLocal((prev) => ({ ...prev, [i]: letter }));
    setChecked(false);
    const res = await send('play', { type: 'letter', index: i, letter });
    if (!res.ok) setError(res.error ?? 'Lettre refusée');
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focus(nextWhite(i, 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focus(nextWhite(i, -1));
    } else if (e.key === 'Backspace' && valueOf(i) === '' && !disabled) {
      e.preventDefault();
      const previous = nextWhite(i, -1);
      focus(previous);
      if (previous >= 0) void write(previous, '');
    }
  }

  function onChange(i: number, raw: string) {
    if (disabled) return;
    const letter = toLetter(raw);
    if (!letter && raw !== '') return;
    void write(i, letter);
    if (letter) focus(nextWhite(i, 1));
  }

  async function check() {
    setError(null);
    const res = await send('play', { type: 'check' });
    if (!res.ok) setError(res.error ?? 'Vérification impossible');
    else setChecked(true);
  }

  function focusClue(clue: Clue) {
    focus(clue.row * view.cols + clue.col);
  }

  return (
    <div className="solo-crossword">
      <div
        className="solo-crossword-grid"
        style={{ gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))` }}
        role="group"
        aria-label="Grille de mots croisés"
      >
        {view.black.map((isBlack, i) =>
          isBlack ? (
            <span key={i} className="solo-xw-black" aria-hidden="true" />
          ) : (
            <label
              key={i}
              className={`solo-xw-cell ${errors.has(i) ? 'is-error' : ''} ${valueOf(i) && !errors.has(i) && checked ? 'is-ok' : ''}`}
            >
              {view.numbers[i] ? <span className="solo-xw-num">{view.numbers[i]}</span> : null}
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={valueOf(i)}
                disabled={disabled}
                maxLength={2}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Case ${view.numbers[i] || i + 1}, ${valueOf(i) || 'vide'}`}
                onChange={(e) => onChange(i, e.target.value)}
                onKeyDown={(e) => onKey(i, e)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          ),
        )}
      </div>

      <div className="solo-xw-actions">
        <button type="button" className="btn ghost" disabled={disabled} onClick={check}>
          Vérifier la grille
        </button>
        {checked && errors.size === 0 && <span className="ok small">Aucune erreur pour l’instant.</span>}
        {checked && errors.size > 0 && <span className="error small">{errors.size} lettre(s) à corriger.</span>}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}

      <div className="solo-xw-clues">
        <ClueList title="Horizontal" clues={view.clues.across} onPick={focusClue} />
        <ClueList title="Vertical" clues={view.clues.down} onPick={focusClue} />
      </div>
    </div>
  );
}

function ClueList({ title, clues, onPick }: { title: string; clues: Clue[]; onPick: (clue: Clue) => void }) {
  return (
    <div>
      <h3 className="solo-xw-title">{title}</h3>
      <ol className="solo-xw-list">
        {clues.map((clue) => (
          <li key={`${title}-${clue.number}`}>
            <button type="button" className="link-btn" onClick={() => onPick(clue)}>
              <strong>{clue.number}.</strong> {clue.text}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
