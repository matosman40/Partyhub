import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { FinalScreen, TimerBar, WaitingScreen } from '../../client/ui.js';
import { useRemaining } from '../../client/hooks.js';
import type { BoardMe, BoardPub } from './common.js';

/** Téléphone d'un jeu de plateau : bouton de lancer quand c'est à soi de jouer. */
export function BoardPlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as BoardPub;
  const me = playerState as BoardMe | null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = useRemaining(pub.turnEndsAt ?? undefined, now);

  if (pub.phase === 'final') {
    const mine = pub.ranking?.find((r) => r.playerId === playerId);
    return <FinalScreen points={mine?.points ?? 0} rank={mine?.rank ?? null} />;
  }
  if (pub.phase === 'lobby') {
    return <WaitingScreen title="Plateau prêt" text="La partie démarre bientôt." />;
  }
  if (me?.spectator) {
    return <WaitingScreen title="Partie en cours" text="Vous rejoindrez la prochaine partie." />;
  }

  async function roll() {
    setBusy(true);
    setError(null);
    const res = await send('roll');
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée.');
  }

  const current = pub.current ? pub.names[pub.current] : '';
  const cellCount = pub.cells.length;

  return (
    <section className="player-game bd-player fade-in">
      <p className="muted">
        Case {(pub.positions[playerId] ?? 0) + 1} sur {cellCount}
      </p>

      {me?.isMyTurn ? (
        <button type="button" className="bd-roll btn primary" disabled={busy} onClick={roll}>
          Lancer les dés
        </button>
      ) : (
        <p className="big">Au tour de {current}</p>
      )}

      {me?.skipped && <p className="muted">Vous passerez votre prochain tour.</p>}
      {pub.turnEndsAt && <TimerBar remaining={remaining} total={pub.turnSeconds} />}
      {pub.lastRoll && <p className="bd-last">{pub.lastRoll.event}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
