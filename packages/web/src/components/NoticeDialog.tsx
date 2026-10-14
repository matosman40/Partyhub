import { useEffect, useRef } from 'react';
import type { GameInfo } from '@partyhub/shared';

/**
 * Notice d'un jeu : but, étapes dans l'ordre, conseils. S'ouvre au-dessus de la page.
 * Échap ou le bouton ferment ; le focus revient au déclencheur.
 */
export function NoticeDialog({ game, onClose }: { game: GameInfo; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const { notice } = game;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <p className="label">
              <span aria-hidden="true">{game.icon}</span> Comment jouer
            </p>
            <h2 id="notice-title">{game.name}</h2>
          </div>
          <button ref={closeRef} type="button" className="btn ghost small" onClick={onClose}>
            Fermer
          </button>
        </div>

        <p className="goal">{notice.goal}</p>

        {notice.steps.length > 0 && (
          <div>
            <h3>Déroulé</h3>
            <ol>
              {notice.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {notice.tips.length > 0 && (
          <div>
            <h3>Astuces</h3>
            <ul>
              {notice.tips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
