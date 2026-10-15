import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Commandes tactiles : une croix de quatre flèches maintenues (gauche, droite, haut, bas), puis Saut et Pousser.
 * Relâcher le doigt n'importe où arrête la marche. Les boutons restent visibles, estompés hors jeu.
 */

export type Side = 'left' | 'right' | 'up' | 'down';
const SIDES: Side[] = ['left', 'right', 'up', 'down'];

/** Place de chaque flèche dans la croix (colonne, ligne). */
const CROSS: Record<Side, { col: number; row: number; label: string; glyph: string }> = {
  up: { col: 2, row: 1, label: 'Aller vers le haut', glyph: '▲' },
  left: { col: 1, row: 2, label: 'Aller à gauche', glyph: '◀' },
  right: { col: 3, row: 2, label: 'Aller à droite', glyph: '▶' },
  down: { col: 2, row: 3, label: 'Aller vers le bas', glyph: '▼' },
};

function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* appareil sans vibration */
  }
}

export interface BanquiseControlsProps {
  disabled: boolean;
  canJump: boolean;
  pushCooldownMs: number;
  onHold: (side: Side, down: boolean) => void;
  onJump: () => void;
  onPush: () => void;
}

export function BanquiseControls({ disabled, canJump, pushCooldownMs, onHold, onJump, onPush }: BanquiseControlsProps) {
  const holdRef = useRef(onHold);
  holdRef.current = onHold;

  // Un doigt levé, n'importe où, relâche les deux flèches.
  useEffect(() => {
    const release = () => {
      for (const side of SIDES) holdRef.current(side, false);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const hold = (side: Side) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (disabled) return;
    buzz(6);
    onHold(side, true);
  };

  const noMenu = (e: ReactMouseEvent) => e.preventDefault();
  const pushReady = pushCooldownMs <= 0;

  return (
    <div className="ban-controls" role="group" aria-label="Commandes">
      <div className="ban-move ban-move--cross" role="group" aria-label="Déplacement">
        {SIDES.map((side) => {
          const key = CROSS[side];
          return (
            <button
              key={side}
              type="button"
              className="dpad-key ban-key"
              aria-label={key.label}
              disabled={disabled}
              onPointerDown={hold(side)}
              onContextMenu={noMenu}
              style={{ gridColumn: key.col, gridRow: key.row }}
            >
              {key.glyph}
            </button>
          );
        })}
      </div>
      <div className="ban-actions" role="group" aria-label="Actions">
        <button
          type="button"
          className="a-btn ban-round"
          aria-label="Sauter"
          disabled={disabled || !canJump}
          onPointerDown={(e) => {
            e.preventDefault();
            if (disabled || !canJump) return;
            buzz(10);
            onJump();
          }}
          onContextMenu={noMenu}
        >
          Saut
        </button>
        <button
          type="button"
          className="a-btn ban-round ban-round--push"
          aria-label={pushReady ? 'Pousser' : 'Pousser, en recharge'}
          disabled={disabled || !pushReady}
          onPointerDown={(e) => {
            e.preventDefault();
            if (disabled || !pushReady) return;
            buzz(14);
            onPush();
          }}
          onContextMenu={noMenu}
        >
          Pousser
        </button>
      </div>
    </div>
  );
}
