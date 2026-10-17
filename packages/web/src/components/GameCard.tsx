import { Link } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { CATEGORY_LABEL } from '../catalog/labels.js';
import { GameLogo } from './GameLogo.js';
import { artStyle, playersLabel } from './GameRow.js';

/**
 * Fiche d'un jeu, façon boutique : vignette aux couleurs du jeu, nom, description et repères.
 * Un clic ouvre la fiche complète. `compact` retire la description (bandeau « Joués récemment »).
 */
export function GameCard({ game, compact = false }: { game: CatalogGame; compact?: boolean }) {
  return (
    <Link
      to={`/jeux/${game.id}`}
      className={`game-card${compact ? ' is-compact' : ''}`}
      style={artStyle(game.id, game.name)}
    >
      <span className="game-card-art" aria-hidden="true">
        <GameLogo gameId={game.id} name={game.name} className="game-card-logo" />
      </span>
      <span className="game-card-body">
        <span className="game-card-name">{game.name}</span>
        {!compact && <span className="game-card-desc">{game.description}</span>}
        <span className="game-card-tags">
          <span className="tag">{CATEGORY_LABEL[game.category]}</span>
          <span className="tag">{playersLabel(game)} joueurs</span>
          <span className="tag">{game.durationMin} min</span>
          {game.ai && <span className="tag tag-ai">IA</span>}
        </span>
      </span>
    </Link>
  );
}
