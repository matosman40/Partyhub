import { useEffect, useState } from 'react';
import type { ActionGrille, Direction } from '@partyhub/shared';

/**
 * Commandes d’un personnage sur le plateau en grille : on choisit ce que fait la direction
 * (marcher, pousser, sauter, porter), puis on pousse dans une direction, ou l’on salue.
 * Au clavier : les flèches font le geste choisi, Espace salue.
 */

export type ModeGrille = 'marcher' | 'pousser' | 'sauter' | 'porter';

export const MODES_GRILLE: Array<{ id: ModeGrille; label: string; aide: string }> = [
  { id: 'marcher', label: 'Marcher', aide: 'Un pas dans la direction choisie. Contre un mur, vous tournez seulement.' },
  {
    id: 'pousser',
    label: 'Pousser',
    aide: 'Pousse la caisse ou le ballon devant vous, s’il y a de la place derrière.',
  },
  { id: 'sauter', label: 'Sauter', aide: 'Saute par-dessus la case devant vous, pour atterrir plus loin.' },
  { id: 'porter', label: 'Porter', aide: 'Prend la boîte devant vous, ou la pose devant vous si vous la portez.' },
];

const DIRECTIONS: Array<{ dir: Direction; label: string; fleche: string; cle: string }> = [
  { dir: 'up', label: 'Haut', fleche: '↑', cle: 'ArrowUp' },
  { dir: 'left', label: 'Gauche', fleche: '←', cle: 'ArrowLeft' },
  { dir: 'right', label: 'Droite', fleche: '→', cle: 'ArrowRight' },
  { dir: 'down', label: 'Bas', fleche: '↓', cle: 'ArrowDown' },
];

export interface GrilleCommandesProps {
  /** Envoie le geste. Retourne le message d’erreur (refus du plateau), ou null si le geste est accepté. */
  onAction: (action: ActionGrille) => Promise<string | null>;
  disabled?: boolean;
  /** Les flèches et Espace pilotent le personnage (ordinateur). */
  clavier?: boolean;
}

export function GrilleCommandes({ onAction, disabled = false, clavier = true }: GrilleCommandesProps) {
  const [mode, setMode] = useState<ModeGrille>('marcher');
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(action: ActionGrille) {
    if (disabled) return;
    const refus = await onAction(action);
    setErreur(refus);
  }

  const dirAction = (dir: Direction): ActionGrille => ({ type: mode, dir });

  useEffect(() => {
    if (!clavier || disabled) return;
    function onKey(e: KeyboardEvent) {
      const cible = e.target as HTMLElement | null;
      // Pas pendant la saisie d’un texte.
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return;
      if (e.key === ' ') {
        e.preventDefault();
        void envoyer({ type: 'saluer' });
        return;
      }
      const d = DIRECTIONS.find((x) => x.cle === e.key);
      if (!d) return;
      e.preventDefault();
      void envoyer({ type: mode, dir: d.dir });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // envoyer lit l’état courant ; il est recréé à chaque rendu, ce qui est voulu ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavier, disabled, mode, onAction]);

  const aide = MODES_GRILLE.find((m) => m.id === mode)?.aide ?? '';

  return (
    <div className="grille-commandes">
      <div className="grille-modes" role="group" aria-label="Ce que fait la direction">
        {MODES_GRILLE.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`grille-mode${mode === m.id ? ' is-active' : ''}`}
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="grille-aide muted small" aria-live="polite">
        {aide}
      </p>
      <div className="grille-pad" role="group" aria-label={`Direction : ${mode}`}>
        {DIRECTIONS.map((d) => (
          <button
            key={d.dir}
            type="button"
            className={`grille-dir grille-dir-${d.dir}`}
            aria-label={`${MODES_GRILLE.find((m) => m.id === mode)?.label ?? ''} vers ${d.label.toLowerCase()}`}
            disabled={disabled}
            onClick={() => void envoyer(dirAction(d.dir))}
          >
            <span aria-hidden="true">{d.fleche}</span>
          </button>
        ))}
        <button
          type="button"
          className="grille-saluer"
          disabled={disabled}
          onClick={() => void envoyer({ type: 'saluer' })}
        >
          <span aria-hidden="true">👋</span> Saluer
        </button>
      </div>
      {erreur && (
        <p className="grille-erreur small" role="alert">
          {erreur}
        </p>
      )}
    </div>
  );
}
