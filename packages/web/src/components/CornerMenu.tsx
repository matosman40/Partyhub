import { useEffect, type ReactNode } from 'react';

/**
 * Menu discret dans un coin de l'écran : un petit bouton qui ouvre un tiroir. Les options et les
 * liens y sont rangés ; ils ne prennent plus de place sur l'écran quand on ne s'en sert pas.
 */
export function CornerMenu({
  open,
  visible = true,
  onOpen,
  onClose,
  children,
}: {
  open: boolean;
  /** Faux : le bouton s'estompe jusqu'au prochain mouvement (écran TV). */
  visible?: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <button
        type="button"
        className={`corner-button${visible || open ? ' is-visible' : ''}`}
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="corner-drawer"
        onClick={open ? onClose : onOpen}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      {open && (
        <>
          <button type="button" className="corner-scrim" aria-label="Fermer le menu" onClick={onClose} tabIndex={-1} />
          <aside id="corner-drawer" className="corner-drawer" aria-label="Menu">
            <div className="corner-drawer-head">
              <p>Menu</p>
              <button type="button" className="btn ghost small" onClick={onClose}>
                Fermer
              </button>
            </div>
            <div className="corner-drawer-body">{children}</div>
          </aside>
        </>
      )}
    </>
  );
}

/** Section du tiroir : un titre simple et son contenu. */
export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="corner-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
