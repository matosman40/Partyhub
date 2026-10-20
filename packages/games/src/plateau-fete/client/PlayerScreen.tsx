import { useContext, useState } from 'react';
import { defaultCharacterFor } from '@partyhub/shared';
import type { PlayerViewProps } from '../../client/types.js';
import { AvatarsContext } from '../../client/avatar-context.js';
import { Character } from '../../client/character.js';
import { WaitingScreen } from '../../client/ui.js';
import { useLocalStart } from '../../client/hooks.js';
import { motionAvailable, motionNeedsPermission, requestMotionAccess } from '../../client/sensors.js';
import { readMediaPrefs, requestCamera, requestMicrophone } from '../../client/media.js';
import {
  BlowChallenge,
  PileChallenge,
  ShakeChallenge,
  SpinChallenge,
  TapChallenge,
  TiltChallenge,
} from '../../micro-defis/client/phone-games.js';
import { ClapChallenge, LumiereChallenge } from '../../micro-defis/client/phone-games-media.js';
import {
  LanceChallenge,
  PinceChallenge,
  SwipeChallenge,
  VibreChallenge,
} from '../../micro-defis/client/phone-games-touch.js';
import { PARI, STAR_COST, TURNS } from '../rules.js';
import { Die } from './Die.js';
import type { MicrogameView, PlateauMine, PlateauPub } from './types.js';

/** Téléphone : le dé, les choix, puis les défis de chaque mini-jeu. */
export function PlateauPlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as PlateauPub | null;
  const me = playerState as PlateauMine | null;
  const avatars = useContext(AvatarsContext);
  const [error, setError] = useState<string | null>(null);
  // Le départ du défi, sur l’horloge de ce téléphone : le curseur « Pile » s’aligne sur celle du serveur.
  const game = pub?.mini?.game ?? null;
  const startedAt = pub?.mini && game ? pub.mini.endsAt - game.durationMs : 0;
  const localStart = useLocalStart(startedAt, now);

  if (!pub || !me) return null;

  const act = (type: string, payload?: unknown) => {
    setError(null);
    void send(type, payload).then((res) => {
      if (!res.ok) setError(res.error ?? 'Action refusée');
    });
  };

  const name = pub.names[playerId] ?? '';
  const header = (
    <PhoneHeader
      name={name}
      spec={avatars[name]?.character ?? defaultCharacterFor(name || '?')}
      coins={me.coins}
      stars={me.stars}
      turn={pub.turn}
      turns={TURNS}
    />
  );

  if (!me.seated) {
    return <WaitingScreen title="Vous assistez à la partie" text="Vous pourrez jouer la prochaine fois." />;
  }

  if (pub.phase === 'ready') {
    return (
      <section className="player-game fade-in pf-phone">
        {header}
        <WaitingScreen title="Préparez-vous !" text="Les pions se placent sur la case départ." />
      </section>
    );
  }

  if (pub.phase === 'final') {
    const mine = pub.final?.find((row) => row.id === playerId);
    return (
      <section className="player-game fade-in pf-phone">
        {header}
        <p className="pf-kicker">Partie terminée</p>
        <p className="big-number">{mine ? `${mine.rank}ᵉ` : '—'}</p>
        <p className="muted">
          ⭐ {me.stars} étoile{me.stars > 1 ? 's' : ''} · 🪙 {me.coins} pièces
        </p>
      </section>
    );
  }

  if (pub.mini) {
    return (
      <section className="player-game fade-in pf-phone">
        {header}
        <MiniPhone
          pub={pub}
          me={me}
          playerId={playerId}
          game={game}
          localStart={localStart}
          onDone={(value) => act('done', { value })}
        />
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="player-game fade-in pf-phone">
      {header}
      {pub.phase === 'banner' && (
        <>
          <p className="pf-kicker">Tour {pub.turn}</p>
          <p className="big">À vos dés !</p>
        </>
      )}

      {pub.phase === 'roll' && (
        <>
          <Die value={me.rolled ? me.roll : null} rolling={false} size="lg" />
          {me.rolled ? (
            <p className="muted">Dé lancé. En attente des autres…</p>
          ) : (
            <button type="button" className="btn big pf-roll" onClick={() => act('roll')}>
              Lancer le dé
            </button>
          )}
        </>
      )}

      {pub.phase === 'move' && (
        <>
          <Die value={me.roll} rolling size="lg" />
          <p className="big-number">+{me.roll ?? 0}</p>
          <p className="muted">
            Vous avancez de {me.roll ?? 0} case{(me.roll ?? 0) > 1 ? 's' : ''}.
          </p>
        </>
      )}

      {pub.phase === 'choice' &&
        (me.choice ? (
          <ChoicePhone choice={me.choice} onChoose={(choice) => act('choose', { choice })} />
        ) : (
          <WaitingScreen title="Choix en cours" text="Les autres joueurs décident encore." />
        ))}

      {pub.phase === 'resolve' && (
        <>
          <p className="pf-kicker">Bilan du tour</p>
          <p className="big-number">🪙 {me.coins}</p>
          <p className="muted">Étoiles : {me.stars}</p>
          <p className="muted small">Tour suivant dans quelques secondes…</p>
        </>
      )}

      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PhoneHeader({
  name,
  spec,
  coins,
  stars,
  turn,
  turns,
}: {
  name: string;
  spec: ReturnType<typeof defaultCharacterFor>;
  coins: number;
  stars: number;
  turn: number;
  turns: number;
}) {
  return (
    <header className="pf-phone-head">
      <Character spec={spec} framing="bust" label={name} className="pf-phone-fig" />
      <div>
        <p className="pf-phone-name">
          Tour {turn} / {turns}
        </p>
        <p className="pf-muted small">{name}</p>
      </div>
      <div className="pf-phone-stats">
        <span>🪙 {coins}</span>
        <span>⭐ {stars}</span>
      </div>
    </header>
  );
}

function ChoicePhone({
  choice,
  onChoose,
}: {
  choice: NonNullable<PlateauMine['choice']>;
  onChoose: (choice: string) => void;
}) {
  if (choice.kind === 'etoile') {
    return (
      <>
        <p className="pf-kicker">Une étoile vous attend</p>
        <p className="big">Acheter pour {STAR_COST} pièces ?</p>
        <div className="pf-choices">
          <button type="button" className="btn big" onClick={() => onChoose('acheter')}>
            Acheter ⭐
          </button>
          <button type="button" className="btn big ghost" onClick={() => onChoose('garder')}>
            Garder mes pièces
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="pf-kicker">{choice.title}</p>
      <p className="big">Tentez le coup ?</p>
      <div className="pf-choices">
        <button type="button" className="btn big" onClick={() => onChoose('risque')}>
          Risquer : +{PARI.win} ou −{PARI.lose}
        </button>
        <button type="button" className="btn big ghost" onClick={() => onChoose('prudence')}>
          Jouer prudent : +{PARI.safe}
        </button>
      </div>
    </>
  );
}

/** Un mini-jeu sur le téléphone : l’annonce du défi, le défi, puis le résultat de ce téléphone. */
function MiniPhone({
  pub,
  me,
  playerId,
  game,
  localStart,
  onDone,
}: {
  pub: PlateauPub;
  me: PlateauMine;
  playerId: string;
  game: MicrogameView | null;
  localStart: number;
  onDone: (value: number) => void;
}) {
  const mini = pub.mini;
  if (!mini) return null;
  if (pub.phase === 'mg-intro') {
    return <MiniIntro mini={mini} game={game} />;
  }
  if (pub.phase === 'mg-play' && game) {
    if (me.mini?.submitted) {
      return <WaitingScreen title="Envoyé !" text="Regardez l’écran : le bilan arrive à la fin du défi." />;
    }
    return (
      <>
        <p className="pf-kicker">
          Défi {mini.round} / {mini.rounds}
        </p>
        <Challenge key={`${mini.number}-${mini.round}`} game={game} localStart={localStart} onDone={onDone} />
      </>
    );
  }
  if (pub.phase === 'mg-reveal') {
    const mine = me.mini?.reveal;
    return (
      <>
        <p className="verdict">{mine?.success ? 'Réussi !' : 'Raté'}</p>
        {mine && mine.points > 0 && <p className="big-number">+{mine.points}</p>}
        <p className="muted small">Défi suivant dans quelques secondes…</p>
      </>
    );
  }
  if (pub.phase === 'mg-results') {
    const payout = me.mini?.payout ?? 0;
    const rank = pub.standings.find((row) => row.id === playerId)?.rank;
    return (
      <>
        <p className="pf-kicker">Mini-jeu {mini.number} terminé</p>
        <p className="big-number">+{payout} 🪙</p>
        <p className="muted">{me.mini?.points ?? 0} points sur le mini-jeu</p>
        {rank !== undefined && <p className="muted small">Classement général : {rank}</p>}
      </>
    );
  }
  return null;
}

/** Présentation du mini-jeu, avec le bouton d’autorisation des capteurs (iOS demande un appui). */
function MiniIntro({ mini, game }: { mini: NonNullable<PlateauPub['mini']>; game: MicrogameView | null }) {
  const [note, setNote] = useState<string | null>(null);
  const needsMotion = game?.sensor === 'shake' || game?.sensor === 'tilt' || game?.sensor === 'spin';
  const needsMic = game?.sensor === 'mic' || game?.sensor === 'clap';
  const needsCamera = game?.sensor === 'camera';

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
    <>
      <p className="pf-kicker">Mini-jeu {mini.number}</p>
      <p className="big">Cinq défis, à vos téléphones</p>
      {game && (
        <>
          <p className="pf-defi-icon" aria-hidden="true">
            {game.icon}
          </p>
          <p className="muted">
            Premier défi : <strong>{game.name}</strong>
          </p>
          <p className="muted small">{game.hint}</p>
        </>
      )}
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
    </>
  );
}

/** Le défi lui-même : même manière de jouer que dans les micro-défis, pour le même capteur. */
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
