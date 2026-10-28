import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  actionContextuelle,
  devantLePersonnage,
  themeDePlateau,
  type ActionGrille,
  type Devant,
  type Direction,
  type EtatGrille,
  type ThemeId,
} from '@partyhub/shared';

/**
 * Manette d’un personnage sur le plateau en grille, façon console : une croix de direction, et trois
 * boutons. La croix marche. « Action » fait ce qu’il faut selon ce qui est devant (prendre, poser,
 * pousser). « Sauter » saute par-dessus la case devant. « Saluer » salue. La bande du haut dit ce qui
 * est devant le personnage. Tout est transparent : le plateau reste visible derrière.
 *
 * Au clavier : flèches pour marcher, Espace pour Action, Entrée pour Sauter, S pour Saluer.
 */

const DIRECTIONS: Array<{ dir: Direction; label: string; fleche: string; cle: string }> = [
  { dir: 'up', label: 'haut', fleche: '↑', cle: 'ArrowUp' },
  { dir: 'left', label: 'gauche', fleche: '←', cle: 'ArrowLeft' },
  { dir: 'right', label: 'droite', fleche: '→', cle: 'ArrowRight' },
  { dir: 'down', label: 'bas', fleche: '↓', cle: 'ArrowDown' },
];

/** Ce que dit la bande du haut, selon ce qui est devant. */
export function libelleDevant(devant: Devant | null, portant: boolean): string {
  if (portant) return 'Vous portez une boîte : Action la pose devant vous';
  switch (devant) {
    case 'mur':
      return 'Un mur devant vous';
    case 'personnage':
      return 'Quelqu’un devant vous';
    case 'caisse':
      return 'Une caisse devant vous : Action la pousse';
    case 'ballon':
      return 'Un ballon devant vous : Action le pousse';
    case 'boite':
      return 'Une boîte devant vous : Action la prend';
    case 'rien':
      return 'Rien devant vous';
    default:
      return 'Vous n’êtes pas sur le plateau';
  }
}

export interface GrilleControleurProps {
  etat: EtatGrille;
  /** Identifiant du personnage de cet appareil. */
  moi: string;
  /** Envoie le geste. Retourne le message d’erreur (refus du plateau), ou null si le geste est accepté. */
  onAction: (action: ActionGrille) => Promise<string | null>;
  disabled?: boolean;
  /** Les touches du clavier pilotent le personnage (ordinateur). */
  clavier?: boolean;
  /** Le plateau lui-même, dessiné sous les commandes. */
  children: ReactNode;
  /** Décor du plateau : il colore aussi la manette. */
  theme?: ThemeId;
  /**
   * Actions secondaires (émotions, gestes de jeu…), cachées dans un tiroir qui monte depuis le bas.
   * Absent : pas de tiroir.
   */
  tiroir?: ReactNode;
}

export function GrilleControleur({
  etat,
  moi,
  onAction,
  disabled = false,
  clavier = true,
  children,
  theme,
  tiroir,
}: GrilleControleurProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const t = themeDePlateau(theme);
  const perso = etat.personnages[moi];
  const portant = etat.objets.some((o) => o.porte === moi);
  const devant = devantLePersonnage(etat, moi);

  async function envoyer(action: ActionGrille) {
    if (disabled) return;
    setMessage(await onAction(action));
  }

  function action() {
    const a = actionContextuelle(etat, moi);
    if (!a) {
      setMessage('Rien à faire ici.');
      return;
    }
    void envoyer(a);
  }

  function sauter() {
    if (!perso) return;
    void envoyer({ type: 'sauter', dir: perso.dir });
  }

  // Les touches suivent l’état courant : l’écouteur est refait à chaque changement de plateau.
  useEffect(() => {
    if (!clavier || disabled) return;
    function onKey(e: KeyboardEvent) {
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return;
      const d = DIRECTIONS.find((x) => x.cle === e.key);
      if (d) {
        e.preventDefault();
        void envoyer({ type: 'marcher', dir: d.dir });
      } else if (e.key === ' ') {
        e.preventDefault();
        action();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        sauter();
      } else if (e.key === 's' || e.key === 'S') {
        void envoyer({ type: 'saluer' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Les fonctions lisent l’état courant : elles sont recréées à chaque rendu, ce qui est voulu ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavier, disabled, etat, onAction]);

  return (
    <section
      className={`grille-console${ouvert ? ' is-ouvert' : ''}`}
      aria-label="Manette du personnage"
      style={{ '--fond': t.fond, '--ciel': t.ciel } as CSSProperties}
    >
      <div className="grille-plateau">{children}</div>

      <div className="grille-bande" aria-live="polite">
        <span className="grille-bande-devant">{libelleDevant(devant, portant)}</span>
        {message && (
          <span className="grille-bande-message" role="status">
            {message}
          </span>
        )}
      </div>

      <div className="grille-manette">
        <div className="grille-croix" role="group" aria-label="Direction">
          {DIRECTIONS.map((d) => (
            <button
              key={d.dir}
              type="button"
              className={`grille-bouton grille-croix-${d.dir}`}
              aria-label={`Aller vers ${d.label}`}
              disabled={disabled}
              onClick={() => void envoyer({ type: 'marcher', dir: d.dir })}
            >
              <span aria-hidden="true">{d.fleche}</span>
            </button>
          ))}
        </div>

        <div className="grille-boutons" role="group" aria-label="Boutons">
          <button
            type="button"
            className="grille-bouton grille-b-saluer"
            disabled={disabled}
            onClick={() => void envoyer({ type: 'saluer' })}
          >
            <span aria-hidden="true">👋</span>
            <span className="grille-bouton-nom">Saluer</span>
          </button>
          <button type="button" className="grille-bouton grille-b-action" disabled={disabled} onClick={action}>
            <span aria-hidden="true">✋</span>
            <span className="grille-bouton-nom">Action</span>
          </button>
          <button type="button" className="grille-bouton grille-b-sauter" disabled={disabled} onClick={sauter}>
            <span aria-hidden="true">⤴</span>
            <span className="grille-bouton-nom">Sauter</span>
          </button>
        </div>
      </div>

      {tiroir && (
        <>
          <button
            type="button"
            className="grille-tiroir-poignee"
            aria-expanded={ouvert}
            aria-controls="grille-tiroir"
            onClick={() => setOuvert((o) => !o)}
          >
            <span aria-hidden="true">{ouvert ? '⌄' : '⌃'}</span> {ouvert ? 'Fermer' : 'Plus d’actions'}
          </button>
          <div id="grille-tiroir" className="grille-tiroir" aria-hidden={!ouvert} inert={!ouvert}>
            {tiroir}
          </div>
        </>
      )}
    </section>
  );
}
