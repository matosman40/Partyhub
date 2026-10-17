import { Link } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { CATEGORY_LABEL } from '../catalog/labels.js';
import { CATEGORY_CLASS, artStyle, playersLabel } from '../catalog/display.js';
import { GameLogo } from './GameLogo.js';

/**
 * Une ligne de la liste du catalogue : vignette, nom et repères. Un clic ouvre la fiche du jeu,
 * où l’on peut revenir avant de créer une salle.
 */
export function GameListRow({ game }: { game: CatalogGame }) {
  return (
    <li className={`game-row cat-${CATEGORY_CLASS[game.category] ?? 'party'}`}>
      <Link to={`/jeux/${game.id}`} className="game-row-head">
        <span className="game-row-art" style={artStyle(game.id, game.name)} aria-hidden="true">
          <GameLogo gameId={game.id} name={game.name} className="game-row-logo" />
        </span>
        <span className="game-row-title">
          <span className="game-row-name">{game.name}</span>
          <span className="game-row-meta">
            {CATEGORY_LABEL[game.category]} · {playersLabel(game)} joueurs · environ {game.durationMin} min
          </span>
        </span>
        <span className="game-row-chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
