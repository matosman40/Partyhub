import { useEffect, useId, useRef, useState } from 'react';

export interface GameMenuItem {
  label: string;
  /** Lien de téléchargement (export) : le menu se ferme au clic. */
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
}

/**
 * Actions d’un jeu regroupées sous un bouton « ⋯ ». Motif « bouton qui déplie » : aria-expanded et
 * aria-controls, sans rôle de menu (les flèches du clavier ne sont pas promises). Le menu se ferme
 * par Échap (le focus revient au bouton), par un clic ailleurs, ou au choix d’une action.
 */
export function GameMenu({ gameName, items }: { gameName: string; items: GameMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="game-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn ghost small game-menu-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Autres actions pour ${gameName}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={panelId} className="game-menu-panel">
          {items.map((item) =>
            item.href ? (
              <a key={item.label} className="game-menu-item" href={item.href} download onClick={() => setOpen(false)}>
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                className={`game-menu-item${item.danger ? ' is-danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
