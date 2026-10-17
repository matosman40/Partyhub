import { useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Ranking } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { useChange } from './cues.js';
import { entryOf, rankingOf, sortHandByValue } from './common.js';
import type { RacePlayerState, RacePublic } from './race-common.js';

/** Téléphone de la ressemblance : on touche, le plus vite possible, la carte de sa main qui répond au centre. */
export function RacePlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as RacePublic | null;
  const me = playerState as RacePlayerState | null;
  const [error, setError] = useState<string | null>(null);
  // Évite d’envoyer deux fois la même touche pendant l’aller-retour réseau.
  const pending = useRef(false);

  const lockEndsAt = me && me.lockedUntil > now ? me.lockedUntil : undefined;
  const remainingLock = useRemaining(lockEndsAt, now);
  const locked = remainingLock > 0;

  useChange(pub?.roundWinner ?? null, (_, winner) => {
    if (winner === playerId) play('pickup');
  });
  useChange(pub?.phase ?? '', (_, phase) => {
    if (phase === 'final') play('final');
  });

  if (!pub) return null;

  if (pub.phase === 'final') {
    const rank = rankingOf(pub);
    const mine = rank.find((r) => r.playerId === playerId);
    return (
      <section className="player-game fade-in cards-player">
        <p className="big">Partie terminée</p>
        <p className="big-number">{mine?.points ?? 0} pts</p>
        <p className="muted">Classement final sur l’écran principal.</p>
        <Ranking entries={rank} limit={4} />
      </section>
    );
  }

  if (!pub.started) {
    return (
      <section className="player-game fade-in">
        <p className="big">Préparez-vous !</p>
        <p className="muted">La partie va commencer, gardez les yeux sur l’écran principal.</p>
      </section>
    );
  }

  if (!me || me.spectator) {
    return (
      <section className="player-game fade-in">
        <p className="big">Partie en cours</p>
        <p className="muted">Vous observez cette partie. Rejoignez la prochaine manche.</p>
      </section>
    );
  }

  const center = pub.center ? entryOf(pub.def, pub.center.entry) : undefined;
  const canTap = me.canTap && !locked;
  const hand = sortHandByValue(pub.def, me.hand);

  async function tap(uid: string) {
    if (pending.current || !canTap) return;
    pending.current = true;
    setError(null);
    const res = await send('tap', { cardId: uid });
    pending.current = false;
    if (!res.ok) setError(res.error ?? 'Touche refusée.');
  }

  let banner = 'Touchez la carte qui ressemble au centre !';
  if (pub.phase === 'round-over') {
    if (pub.roundWinner === null) banner = 'Manche sans gagnant…';
    else if (pub.roundWinner === playerId) banner = 'Votre main est vide !';
    else banner = `${pub.names[pub.roundWinner] ?? '?'} termine la manche.`;
  } else if (locked) {
    banner = `Trop tôt… ${Math.ceil(remainingLock / 1000)} s`;
  }

  return (
    <section
      className="player-game fade-in cards-player race-player"
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Manche {pub.round} · {pub.scores[playerId] ?? 0} pts · {me.hand.length} carte{me.hand.length > 1 ? 's' : ''}
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${canTap ? ' is-mine' : ''}`}>{banner}</p>

      <div className="race-center-mini">
        {center ? (
          <CardFace def={pub.def} entry={center} label="Carte du centre" />
        ) : (
          <CardFace def={pub.def} back label="Plus de carte au centre" />
        )}
      </div>

      <div className="pick-hand">
        {hand.map((card) => {
          const entry = entryOf(pub.def, card.entry);
          const label = entry ? entry.label || entry.text?.slice(0, 40) || entry.symbol : 'Carte';
          return (
            <button
              key={card.uid}
              type="button"
              className="pick-card"
              disabled={!canTap}
              aria-label={label}
              onClick={() => void tap(card.uid)}
            >
              <CardFace def={pub.def} entry={entry} label={label} />
            </button>
          );
        })}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
