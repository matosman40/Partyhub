import type { CSSProperties } from 'react';
import type { CatalogGame, GameCategory } from '@partyhub/shared';
import { GameLogo } from './GameLogo.js';
import { logoFor } from './gameLogos.js';

export const CATEGORY_LABEL: Record<GameCategory, string> = {
  cartes: 'Cartes',
  plateau: 'Plateau',
  quiz: 'Quiz',
  role: 'Rôle',
  solo: 'Solo',
};

/** Classe CSS associée à chaque catégorie. */
export const CATEGORY_CLASS: Record<GameCategory, string> = {
  cartes: 'cards',
  plateau: 'plateau',
  quiz: 'quiz',
  role: 'role',
  solo: 'solo',
};

/** Couleurs de l'identité visuelle du jeu, utilisées pour la vignette. */
export function artStyle(id: string, name: string): CSSProperties {
  const [a, b] = logoFor(id, name).sky;
  return { '--sky-a': a, '--sky-b': b } as CSSProperties;
}

/** Nombre de joueurs affiché : « 4 » ou « 2 à 6 ». */
export function playersLabel(game: Pick<CatalogGame, 'minPlayers' | 'maxPlayers'>): string {
  return game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} à ${game.maxPlayers}`;
}

/**
 * Une ligne du catalogue : vignette, nom et repères. Un clic déploie le sous-menu du jeu, avec
 * sa description et ses actions. Un seul sous-menu est ouvert à la fois (géré par la page).
 */
export function GameRow({
  game,
  open,
  creating,
  trying,
  busy,
  onToggle,
  onCreate,
  onTry,
  onNotice,
}: {
  game: CatalogGame;
  open: boolean;
  /** Une création de salle est en cours pour ce jeu. */
  creating: boolean;
  /** Une partie d'essai est en cours de préparation pour ce jeu. */
  trying: boolean;
  /** Une action est en cours (pour ce jeu ou un autre) : les boutons sont désactivés. */
  busy: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onTry: () => void;
  onNotice: () => void;
}) {
  const panelId = `game-panel-${game.id}`;
  return (
    <li className={`game-row cat-${CATEGORY_CLASS[game.category] ?? 'party'}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="game-row-head"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <span className="game-row-art" style={artStyle(game.id, game.name)} aria-hidden="true">
          <GameLogo gameId={game.id} name={game.name} className="game-row-logo" />
        </span>
        <span className="game-row-title">
          <span className="game-row-name">{game.name}</span>
          <span className="game-row-meta">
            {CATEGORY_LABEL[game.category] ?? game.category} · {playersLabel(game)} joueurs · environ {game.durationMin}{' '}
            min
          </span>
        </span>
        <span className="game-row-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="game-row-panel" id={panelId}>
          <p>{game.description}</p>
          <div className="game-row-actions">
            <button type="button" className="btn primary big" disabled={busy} onClick={onCreate}>
              {creating ? 'Création…' : 'Créer la salle'}
            </button>
            <button type="button" className="btn big" disabled={busy} onClick={onTry}>
              {trying ? 'Préparation…' : 'Essayer seul'}
            </button>
            <button type="button" className="link-btn" onClick={onNotice}>
              Comment jouer
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
