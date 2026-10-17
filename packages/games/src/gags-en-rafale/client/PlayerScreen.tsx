import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { motionAvailable, motionNeedsPermission, requestMotionAccess } from '../../client/sensors.js';
import { useLocalStart } from '../../client/hooks.js';
import {
  BalloonChallenge,
  MoucheChallenge,
  ScratchChallenge,
  StillChallenge,
  SwipeChallenge,
  WaitChallenge,
  type ChallengeProps,
} from './phone-games.js';
import type { GagView, GagsMine, GagsPub } from './types.js';
import type { Answer } from '../gags.js';

export function GagsPlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as GagsPub | null;
  const me = playerState as GagsMine | null;
  const [error, setError] = useState<string | null>(null);
  // Instant du début du gag sur ce téléphone : l'horloge serveur moins le trajet de la vue.
  const localStart = useLocalStart(pub?.startedAt ?? 0, now);

  if (!pub) return null;

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  if (pub.phase === 'final') {
    const mine = pub.ranking.find((e) => e.playerId === playerId);
    return <FinalScreen points={mine?.points ?? me?.points ?? 0} rank={mine?.rank ?? null} />;
  }

  const gag = pub.microgame;
  if (!gag) return <WaitingScreen title="Gag suivant…" />;

  if (pub.phase === 'intro') {
    return <IntroPhone pub={pub} gag={gag} />;
  }

  if (pub.phase === 'play') {
    if (me?.submitted) {
      return gag.input === 'wait' ? (
        <WaitingScreen title="Touché !" text="Le bilan arrive à la fin du gag, sur l’écran principal." />
      ) : (
        <WaitingScreen title="Envoyé !" text="Regardez l’écran : le bilan arrive à la fin du gag." />
      );
    }
    const onDone = (answer: Answer) => {
      setError(null);
      void send('done', answer).then((res) => {
        if (!res.ok) setError(res.error ?? 'Réponse refusée');
      });
    };
    return (
      <section className="player-game fade-in gag-phone">
        <p className="gag-round">
          {pub.round} / {pub.rounds} · {gag.name}
        </p>
        <Challenge key={`${pub.round}-${gag.id}`} gag={gag} localStart={localStart} onDone={onDone} />
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
  return (
    <section className="player-game fade-in gag-phone">
      <p className="gag-verdict">{me?.mine?.success ? 'Réussi !' : me?.submitted ? 'Raté' : 'Pas de réponse'}</p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p className="muted">Total : {me?.points ?? 0} pts</p>
      <p className="muted small">Gag suivant dans quelques secondes…</p>
    </section>
  );
}

/** Présentation du gag, avec le bouton d'autorisation du mouvement (iOS demande un appui pour les capteurs). */
function IntroPhone({ pub, gag }: { pub: GagsPub; gag: GagView }) {
  const [note, setNote] = useState<string | null>(null);
  const needsMotion = gag.input === 'still';

  async function allowMotion() {
    const access = await requestMotionAccess();
    setNote(access === 'granted' ? 'Mouvement autorisé.' : 'Mouvement refusé : ce gag ne pourra pas être réussi.');
  }

  return (
    <section className="player-game fade-in gag-phone">
      <p className="gag-round">
        Gag {pub.round} / {pub.rounds}
      </p>
      <p className="gag-icon" aria-hidden="true">
        {gag.icon}
      </p>
      <h2 className="gag-name">{gag.name}</h2>
      <p className="gag-flavor">{gag.flavor}</p>
      <p className="gag-instruction">{gag.instruction}</p>
      <p className="muted small">{gag.hint}</p>
      {needsMotion && motionAvailable() && motionNeedsPermission() && (
        <button type="button" className="btn small" onClick={allowMotion}>
          Autoriser le mouvement
        </button>
      )}
      {note && <p className="notice small">{note}</p>}
    </section>
  );
}

function Challenge({
  gag,
  localStart,
  onDone,
}: {
  gag: GagView;
  localStart: number;
  onDone: (answer: Answer) => void;
}) {
  const props: ChallengeProps = { localStart, seed: gag.seed, onDone };
  switch (gag.input) {
    case 'swipe':
      return <SwipeChallenge {...props} />;
    case 'moving-target':
      return <MoucheChallenge {...props} />;
    case 'press-release':
      return <BalloonChallenge {...props} />;
    case 'wait':
      return <WaitChallenge {...props} />;
    case 'still':
      return <StillChallenge onDone={onDone} />;
    case 'scratch':
      return <ScratchChallenge {...props} />;
  }
}
