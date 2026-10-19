import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { motionAvailable, motionNeedsPermission, requestMotionAccess } from '../../client/sensors.js';
import { readMediaPrefs, requestCamera, requestMicrophone } from '../../client/media.js';
import { useLocalStart } from '../../client/hooks.js';
import {
  BlowChallenge,
  PileChallenge,
  ShakeChallenge,
  SpinChallenge,
  TapChallenge,
  TiltChallenge,
} from './phone-games.js';
import { ClapChallenge, LumiereChallenge } from './phone-games-media.js';
import { LanceChallenge, PinceChallenge, SwipeChallenge, VibreChallenge } from './phone-games-touch.js';
import type { MicroDefisMine, MicroDefisPub, MicrogameView } from './types.js';

export function MicroDefisPlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as MicroDefisPub | null;
  const me = playerState as MicroDefisMine | null;
  const [error, setError] = useState<string | null>(null);
  // Instant du début du défi sur ce téléphone : l’horloge serveur moins le trajet de la vue (le curseur « Pile »
  // s’aligne ainsi sur le serveur, à quelques millisecondes près).
  const startedAt = pub?.startedAt ?? 0;
  const localStart = useLocalStart(startedAt, now);

  if (!pub) return null;

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  if (pub.phase === 'final') {
    const mine = pub.ranking.find((e) => e.playerId === playerId);
    return <FinalScreen points={mine?.points ?? me?.points ?? 0} rank={mine?.rank ?? null} />;
  }

  const game = pub.microgame;
  if (!game) return <WaitingScreen title="Défi suivant…" />;

  if (pub.phase === 'intro') {
    return <IntroPhone pub={pub} game={game} />;
  }

  if (pub.phase === 'play') {
    if (me?.submitted) {
      return <WaitingScreen title="Envoyé !" text="Regardez l’écran : le bilan arrive à la fin du défi." />;
    }
    const onDone = (value: number) => {
      setError(null);
      void send('done', { value }).then((res) => {
        if (!res.ok) setError(res.error ?? 'Réponse refusée');
      });
    };
    return (
      <section className="player-game fade-in mdf-phone">
        <p className="mdf-round">
          {pub.round} / {pub.rounds} · {game.name}
        </p>
        <Challenge key={`${pub.round}-${game.id}`} game={game} localStart={localStart} onDone={onDone} />
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
    <section className="player-game fade-in mdf-phone">
      <p className="verdict">{me?.mine?.success ? 'Réussi !' : me?.submitted ? 'Raté' : 'Pas de réponse'}</p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p className="muted">Total : {me?.points ?? 0} pts</p>
      <p className="muted small">Défi suivant dans quelques secondes…</p>
    </section>
  );
}

/** Présentation du défi, avec le bouton d’autorisation (iOS demande un appui pour les capteurs). */
function IntroPhone({ pub, game }: { pub: MicroDefisPub; game: MicrogameView }) {
  const [note, setNote] = useState<string | null>(null);
  const needsMotion = game.sensor === 'shake' || game.sensor === 'tilt' || game.sensor === 'spin';
  const needsMic = game.sensor === 'mic' || game.sensor === 'clap';
  const needsCamera = game.sensor === 'camera';

  async function allowMotion() {
    const access = await requestMotionAccess();
    setNote(access === 'granted' ? 'Mouvement autorisé.' : 'Mouvement refusé : ce défi ne pourra pas être réussi.');
  }

  async function allowMic() {
    try {
      const flow = await requestMicrophone(readMediaPrefs());
      flow.getTracks().forEach((t) => t.stop());
      setNote('Micro autorisé.');
    } catch {
      setNote('Micro refusé : ce défi ne pourra pas être réussi.');
    }
  }

  async function allowCamera() {
    try {
      const flow = await requestCamera(readMediaPrefs(), 'environment');
      flow.getTracks().forEach((t) => t.stop());
      setNote('Caméra autorisée.');
    } catch {
      setNote('Caméra refusée : ce défi ne pourra pas être réussi.');
    }
  }

  return (
    <section className="player-game fade-in mdf-phone">
      <p className="mdf-round">
        Défi {pub.round} / {pub.rounds}
      </p>
      <p className="mdf-icon" aria-hidden="true">
        {game.icon}
      </p>
      <h2 className="mdf-name">{game.name}</h2>
      <p className="mdf-instruction">{game.instruction}</p>
      <p className="muted small">{game.hint}</p>
      {needsMotion && motionAvailable() && motionNeedsPermission() && (
        <button type="button" className="btn small" onClick={allowMotion}>
          Autoriser le mouvement
        </button>
      )}
      {needsMic && (
        <button type="button" className="btn small" onClick={allowMic}>
          Autoriser le micro
        </button>
      )}
      {needsCamera && (
        <button type="button" className="btn small" onClick={allowCamera}>
          Autoriser la caméra
        </button>
      )}
      {note && <p className="notice small">{note}</p>}
    </section>
  );
}

function Challenge({
  game,
  localStart,
  onDone,
}: {
  game: MicrogameView;
  localStart: number;
  onDone: (value: number) => void;
}) {
  switch (game.sensor) {
    case 'shake':
      return <ShakeChallenge target={game.target} onDone={onDone} />;
    case 'tilt':
      return <TiltChallenge target={game.target} onDone={onDone} />;
    case 'spin':
      return <SpinChallenge target={game.target} onDone={onDone} />;
    case 'mic':
      return <BlowChallenge target={game.target} onDone={onDone} />;
    case 'tap':
      return <TapChallenge target={game.target} onDone={onDone} />;
    case 'timing':
      return <PileChallenge localStart={localStart} durationMs={game.durationMs} onDone={onDone} />;
    case 'swipe':
      return <SwipeChallenge target={game.target} onDone={onDone} />;
    case 'vibrate':
      return <VibreChallenge target={game.target} onDone={onDone} />;
    case 'camera':
      return <LumiereChallenge target={game.target} onDone={onDone} />;
    case 'clap':
      return <ClapChallenge target={game.target} onDone={onDone} />;
    case 'pinch':
      return <PinceChallenge target={game.target} onDone={onDone} />;
    case 'flick':
      return <LanceChallenge target={game.target} onDone={onDone} />;
  }
}
