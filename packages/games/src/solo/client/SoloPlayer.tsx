import type { ComponentType } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { formatElapsed } from './SoloHost.js';
import { SudokuView } from './Sudoku.js';
import { KlondikeView } from './Klondike.js';
import { TaquinView } from './Taquin.js';
import { CrosswordView } from './Crossword.js';

export interface SoloBoardProps {
  board: any;
  disabled: boolean;
  send: PlayerViewProps['send'];
}

const BOARDS: Record<string, ComponentType<SoloBoardProps>> = {
  sudoku: SudokuView,
  solitaire: KlondikeView,
  taquin: TaquinView,
  'mots-croises': CrosswordView,
};

/** Téléphone d’un jeu solo : la grille du joueur, son avancement et le temps restant. */
export function SoloPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <h2>Partie terminée</h2>
        <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />
      </section>
    );
  }

  if (pub.phase === 'ready') {
    return <WaitingScreen title={`${pub.icon} ${pub.name}`} text="La grille apparaîtra au lancement." />;
  }

  const Board = BOARDS[pub.game];
  const board = me?.board ?? null;
  const done = me?.done === true;

  return (
    <section className="player-game solo-player fade-in">
      <div className="round-info">
        {pub.icon} {pub.name} · {me?.percent ?? 0} %{pub.limitMs > 0 && <> · {Math.ceil(remaining / 1000)} s</>}
      </div>
      {done ? (
        <p className="notice">
          Grille résolue en {formatElapsed(me.elapsedMs ?? 0)}
          {me?.rank ? ` · ${me.rank}ᵉ` : ''}. Regardez l’écran principal.
        </p>
      ) : null}
      {Board && board && (
        <Board
          board={board}
          disabled={done || pub.phase !== 'play' || (remaining <= 0 && pub.limitMs > 0)}
          send={send}
        />
      )}
    </section>
  );
}
