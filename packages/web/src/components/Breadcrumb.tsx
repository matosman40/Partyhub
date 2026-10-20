import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Page à ouvrir. */
  to?: string;
  /** Action locale (revenir à un menu sans quitter la page). */
  onClick?: () => void;
}

/**
 * Fil d’Ariane, le même partout : Accueil › … › page courante. La dernière étape n’est pas un lien. Remplace les
 * boutons « retour » dispersés, pour savoir toujours où l’on est et revenir d’un coup à un niveau plus haut.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Fil d’Ariane" className="breadcrumb">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          let node: ReactNode;
          if (last) {
            node = <span aria-current="page">{item.label}</span>;
          } else if (item.to) {
            node = <Link to={item.to}>{item.label}</Link>;
          } else if (item.onClick) {
            node = (
              <button type="button" onClick={item.onClick}>
                {item.label}
              </button>
            );
          } else {
            node = <span>{item.label}</span>;
          }
          return (
            <li key={`${index}-${item.label}`}>
              {node}
              {!last && (
                <span className="breadcrumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
