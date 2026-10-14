import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Dir } from './render.js';

/**
 * Commandes tactiles, toujours visibles en bas de l'écran : une croix de
 * quatre grosses touches à gauche et le bouton A à droite. Une touche maintenue
 * répète le déplacement. Désactivées (estompées) hors manche, mais jamais cachées.
 */

const REPEAT_MS = 105;

function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* appareil sans vibration */
  }
}

const KEY_LABEL: Record<Dir, { glyph: string; label: string; area: string }> = {
  up: { glyph: '▲', label: 'Haut', area: '1 / 2' },
  left: { glyph: '◀', label: 'Gauche', area: '2 / 1' },
  right: { glyph: '▶', label: 'Droite', area: '2 / 3' },
  down: { glyph: '▼', label: 'Bas', area: '3 / 2' },
};

export function Gamepad({
  onMove,
  onBomb,
  disabled = false,
}: {
  onMove: (dir: Dir) => void;
  onBomb: () => void;
  disabled?: boolean;
}) {
  const [held, setHeld] = useState<Dir | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  // Répétition tant qu'une touche reste enfoncée.
  useEffect(() => {
    if (!held || disabled) return;
    const id = window.setInterval(() => moveRef.current(held), REPEAT_MS);
    return () => window.clearInterval(id);
  }, [held, disabled]);

  // Relâcher le doigt n'importe où arrête la répétition.
  useEffect(() => {
    const stop = () => setHeld(null);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const press = (dir: Dir) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (disabled) return;
    buzz(8);
    moveRef.current(dir);
    setHeld(dir);
  };

  const key = (dir: Dir) => {
    const { glyph, label, area } = KEY_LABEL[dir];
    return (
      <button
        key={dir}
        type="button"
        aria-label={label}
        disabled={disabled}
        className={`dpad-key${held === dir ? ' is-held' : ''}`}
        style={{ gridArea: area }}
        onPointerDown={press(dir)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {glyph}
      </button>
    );
  };

  return (
    <div className="gamepad" role="group" aria-label="Commandes">
      <div className="dpad" role="group" aria-label="Déplacement">
        {(['up', 'left', 'right', 'down'] as Dir[]).map(key)}
      </div>
      <button
        type="button"
        className="a-btn"
        disabled={disabled}
        aria-label="Poser une bombe (bouton A)"
        onPointerDown={(e) => {
          e.preventDefault();
          if (disabled) return;
          buzz(12);
          onBomb();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        A
      </button>
    </div>
  );
}
