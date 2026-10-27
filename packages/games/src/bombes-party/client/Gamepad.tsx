import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Dir } from './render.js';

/**
 * Commandes tactiles, toujours visibles en bas de l’écran : une rangée de gestes du kangourou au-dessus,
 * puis une croix de quatre grosses touches à gauche et le bouton A à droite. Une touche maintenue
 * répète le déplacement. Les gestes et le bouton A sont estompés hors de leur utilisation, mais jamais cachés.
 */

/** Gestes du kangourou monté : soulever la bombe devant soi, la lancer, ou lui donner un coup. */
export type RideAction = 'lift' | 'throw' | 'kick';
/** Ce qui est possible maintenant, calculé par le serveur. */
export type RideOptions = Record<RideAction, boolean>;

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

const RIDE_BUTTONS: Array<{ action: RideAction; label: string; hint: string }> = [
  { action: 'lift', label: 'Soulever', hint: 'Soulever la bombe devant vous' },
  { action: 'throw', label: 'Lancer', hint: 'Lancer la bombe portée, jusqu’à trois cases' },
  { action: 'kick', label: 'Frapper', hint: 'Donner un coup à la bombe devant vous' },
];

/** Expressions : danser ou sourire sur place. */
export type EmoteKind = 'dance' | 'smile';
const EMOTES: Array<{ kind: EmoteKind; label: string; icon: string }> = [
  { kind: 'dance', label: 'Danser', icon: '💃' },
  { kind: 'smile', label: 'Sourire', icon: '😄' },
];

export function Gamepad({
  onMove,
  onBomb,
  onRide,
  ride = null,
  onEmote,
  disabled = false,
}: {
  onMove: (dir: Dir) => void;
  onBomb: () => void;
  /** Gestes du kangourou. Absent : pas de rangée de gestes. */
  onRide?: (action: RideAction) => void;
  /** Gestes possibles maintenant ; null hors kangourou monté. */
  ride?: RideOptions | null;
  /** Expressions (danser, sourire). Absent : pas de rangée d’expressions. */
  onEmote?: (kind: EmoteKind) => void;
  disabled?: boolean;
}) {
  const [held, setHeld] = useState<Dir | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  // Répétition tant qu’une touche reste enfoncée.
  useEffect(() => {
    if (!held || disabled) return;
    const id = window.setInterval(() => moveRef.current(held), REPEAT_MS);
    return () => window.clearInterval(id);
  }, [held, disabled]);

  // Relâcher le doigt n’importe où arrête la répétition.
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
    <div className="gamepad-stack">
      {onEmote && (
        <div className="emote-row" role="group" aria-label="Expressions">
          {EMOTES.map(({ kind, label, icon }) => (
            <button
              key={kind}
              type="button"
              className="emote-btn"
              disabled={disabled}
              aria-label={`${label} sur place`}
              title={`${label} sur place`}
              onPointerDown={(e) => {
                e.preventDefault();
                if (disabled) return;
                buzz(8);
                onEmote(kind);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>
      )}
      {onRide && (
        <div className="ride-row" role="group" aria-label="Gestes du kangourou">
          {RIDE_BUTTONS.map(({ action, label, hint }) => {
            const on = !disabled && !!ride?.[action];
            return (
              <button
                key={action}
                type="button"
                className="ride-btn"
                disabled={!on}
                title={hint}
                aria-label={`${label} : ${hint}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (!on) return;
                  buzz(10);
                  onRide(action);
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
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
    </div>
  );
}
