import type { ReactNode } from 'react';
import { Boundary } from './Boundary.js';

/**
 * Vue d'un jeu, sur l'écran principal, sur un téléphone ou en observation. Si elle plante, seule cette
 * zone le dit : la partie continue sur le serveur, et la vue reprend à l'étape suivante.
 */
export function GameViewBoundary({
  gameId,
  publicState,
  children,
}: {
  gameId: string;
  publicState: unknown;
  children: ReactNode;
}) {
  return (
    <Boundary resetKey={stepKeyOf(gameId, publicState)} fallback={<GameViewFallback />}>
      {children}
    </Boundary>
  );
}

/** Message affiché à la place d'une vue de jeu en erreur. Il dit ce qui se passe, sans jargon. */
export function GameViewFallback() {
  return (
    <div className="game-view-error" role="alert">
      <p>Cette étape du jeu n’a pas pu s’afficher.</p>
      <p className="muted small">La partie continue : l’affichage reprend à l’étape suivante.</p>
    </div>
  );
}

/** Identifie l'étape d'un jeu (jeu, étape et manche) : une vue en erreur reprend quand elle change. */
export function stepKeyOf(gameId: string, publicState: unknown): string {
  if (!publicState || typeof publicState !== 'object') return gameId;
  const { phase, round } = publicState as { phase?: unknown; round?: unknown };
  return [gameId, primitive(phase), primitive(round)].join('|');
}

function primitive(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
