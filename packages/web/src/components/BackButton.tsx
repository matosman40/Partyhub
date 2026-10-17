import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Bouton « retour » : un lien vers une page, ou une action locale (ex. revenir à un menu sans quitter
 * la page). Toujours du même style pour que l'on sache où le trouver.
 */
export function BackButton({ to, onClick, children }: { to?: string; onClick?: () => void; children: ReactNode }) {
  const content = (
    <>
      <span aria-hidden="true">←</span> {children}
    </>
  );
  if (to) {
    return (
      <Link className="btn ghost back-btn" to={to}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className="btn ghost back-btn" onClick={onClick}>
      {content}
    </button>
  );
}
