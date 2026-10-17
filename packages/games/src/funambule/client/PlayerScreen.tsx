import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { motionAvailable, motionNeedsPermission, requestMotionAccess } from '../../client/sensors.js';
import { useLocalStart } from '../../client/hooks.js';
import { WALK_MS } from '../rules.js';
import { WalkChallenge } from './phone-walk.js';
import { secondsLabel } from './wind.js';
import type { FunambuleMine, FunambulePub, WindView } from './types.js';

export function FunambulePlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as FunambulePub | null;
  const me = playerState as FunambuleMine | null;
  const [error, setError] = useState<string | null>(null);
  // Résultat envoyé pour une manche : gardé à l’écran jusqu’au bilan, même quand la réponse serveur arrive.
  const [sent, setSent] = useState<{ round: number; crossed: boolean } | null>(null);
  // Début de la traversée sur ce téléphone : l’horloge serveur moins le trajet de la vue.
  const localStart = useLocalStart(pub?.startedAt ?? 0, now);

  if (!pub) return null;

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="Le fil sera tendu sur l’écran principal." />;
  }

  if (pub.phase === 'final') {
    const mine = pub.ranking.find((e) => e.playerId === playerId);
    return <FinalScreen points={mine?.points ?? me?.points ?? 0} rank={mine?.rank ?? null} />;
  }

  if (!pub.wind) return <WaitingScreen title="Manche suivante…" />;

  if (pub.phase === 'intro') {
    return <IntroPhone pub={pub} wind={pub.wind} />;
  }

  if (pub.phase === 'walk') {
    if (sent?.round === pub.round) return <SettledPhone crossed={sent.crossed} error={error} />;
    // Déjà jouée avant le rechargement de la page : on attend le bilan.
    if (me?.submitted) {
      return (
        <WaitingScreen
          title="Traversée envoyée !"
          text="Regardez l’écran : le bilan arrive à la fin de la traversée."
        />
      );
    }
    const onDone = (survivedMs: number) => {
      setError(null);
      setSent({ round: pub.round, crossed: survivedMs >= WALK_MS });
      void send('done', { value: survivedMs }).then((res) => {
        if (!res.ok) setError(res.error ?? 'Réponse refusée');
      });
    };
    return (
      <section className="player-game fade-in fnb-phone">
        <p className="fnb-round">
          Manche {pub.round} / {pub.rounds}
        </p>
        <WalkChallenge key={pub.round} wind={pub.wind} localStart={localStart} onDone={onDone} />
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  // Bilan
  const gained = me?.mine?.points ?? 0;
  const survived = me?.mine?.survived ?? 0;
  const crossed = me?.mine?.success ?? false;
  return (
    <section className="player-game fade-in fnb-phone">
      <p className="verdict">{crossed ? 'Arrivé !' : me?.submitted ? 'Tombé' : 'Pas de réponse'}</p>
      {me?.mine && (
        <p className="muted">
          Tenu {secondsLabel(survived)} sur {secondsLabel(WALK_MS)}
        </p>
      )}
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p className="muted">Total : {me?.points ?? 0} pts</p>
      <p className="muted small">Manche suivante dans quelques secondes…</p>
    </section>
  );
}

/** Le verdict du téléphone pendant la traversée des autres : il ne change pas avant le bilan. */
function SettledPhone({ crossed, error }: { crossed: boolean; error: string | null }) {
  return (
    <section className="player-game fade-in fnb-phone">
      <div className="fnb-challenge fnb-settled" role="status">
        <p className="fnb-verdict">{crossed ? 'Arrivé de l’autre côté !' : 'Tombé du fil !'}</p>
        <p className="muted small">Regardez l’écran : le bilan arrive à la fin de la traversée.</p>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** Présentation de la manche, avec le bouton d’autorisation (iOS demande un appui pour les capteurs). */
function IntroPhone({ pub, wind }: { pub: FunambulePub; wind: WindView }) {
  const [note, setNote] = useState<string | null>(null);
  const canAsk = motionAvailable() && motionNeedsPermission();

  async function allowMotion() {
    const access = await requestMotionAccess();
    setNote(access === 'granted' ? 'Mouvement autorisé.' : 'Mouvement refusé : le funambule ne peut pas tenir le fil.');
  }

  return (
    <section className="player-game fade-in fnb-phone">
      <p className="fnb-round">
        Manche {pub.round} / {pub.rounds}
      </p>
      <p className="fnb-icon" aria-hidden="true">
        🤸
      </p>
      <h2 className="fnb-name">Funambule</h2>
      <p className="fnb-instruction">Penchez le téléphone du côté opposé au vent.</p>
      <p className="muted small">
        {wind.label} · tenez {secondsLabel(WALK_MS)} sur le fil.
      </p>
      {canAsk && (
        <button type="button" className="btn small" onClick={allowMotion}>
          Autoriser le mouvement
        </button>
      )}
      {!motionAvailable() && (
        <p className="notice small">
          Ce téléphone ne transmet pas le mouvement : le funambule ne peut pas tenir le fil.
        </p>
      )}
      {note && <p className="notice small">{note}</p>}
    </section>
  );
}
