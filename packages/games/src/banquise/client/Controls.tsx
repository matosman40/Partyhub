import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Commandes tactiles : deux flèches maintenues (gauche, droite), puis Saut et Pousser.
 * Relâcher le doigt n'importe où arrête la marche. Les boutons restent visibles, estompés hors jeu.
 */

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
  onHold: (side: 'left' | 'right', down: boolean) => void;
  onJump: () => void;
  onPush: () => void;
}

export function BanquiseControls({ disabled, canJump, pushCooldownMs, onHold, onJump, onPush }: BanquiseControlsProps) {
  const holdRef = useRef(onHold);
  holdRef.current = onHold;

  // Un doigt levé, n'importe où, relâche les deux flèches.
  useEffect(() => {
    const release = () => {
      holdRef.current('left', false);
      holdRef.current('right', false);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const hold = (side: 'left' | 'right') => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (disabled) return;
    buzz(6);
    onHold(side, true);
  };

  const noMenu = (e: ReactMouseEvent) => e.preventDefault();
  const pushReady = pushCooldownMs <= 0;

  return (
    <div className="ban-controls" role="group" aria-label="Commandes">
      <div className="ban-move" role="group" aria-label="Déplacement">
        <button
          type="button"
          className="dpad-key ban-key"
          aria-label="Aller à gauche"
          disabled={disabled}
          onPointerDown={hold('left')}
          onContextMenu={noMenu}
        >
          ◀
        </button>
        <button
          type="button"
          className="dpad-key ban-key"
          aria-label="Aller à droite"
          disabled={disabled}
          onPointerDown={hold('right')}
          onContextMenu={noMenu}
        >
          ▶
        </button>
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
