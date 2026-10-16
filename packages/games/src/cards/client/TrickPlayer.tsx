import { useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Ranking } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { cueTurn, useChange } from './cues.js';
import { entryOf, rankingOf, sortHandByValue } from './common.js';
import { familyName, type TrickPlayerState, type TrickPublic } from './trick-common.js';

/** Téléphone du pli : on joue une carte à son tour, en fournissant la couleur demandée si on peut. */
export function TrickPlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as TrickPublic | null;
  const me = playerState as TrickPlayerState | null;
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  useChange(me?.isMyTurn ?? false, (_, mine) => {
    if (mine) cueTurn();
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

  const myTurn = me.isMyTurn && pub.phase === 'play';
  const playable = new Set(me.playable);
  const hand = sortHandByValue(pub.def, me.hand);
  const led = familyName(pub.def, pub.ledFamily);
  const trump = familyName(pub.def, pub.trump);

  async function playCard(uid: string) {
    if (pending.current || !myTurn || !playable.has(uid)) return;
    pending.current = true;
    setError(null);
    const res = await send('play', { cardId: uid });
    pending.current = false;
    if (!res.ok) setError(res.error ?? 'Carte refusée.');
  }

  let banner = myTurn ? 'À vous de jouer !' : `Tour de ${pub.names[pub.current ?? ''] ?? '…'}`;
  if (myTurn && led) banner = `À vous : jouez ${led}, si vous pouvez.`;
  if (pub.phase === 'trick-over' && pub.lastTrick) {
    banner =
      pub.lastTrick.winner === playerId
        ? 'Vous remportez le pli !'
        : `${pub.names[pub.lastTrick.winner] ?? '?'} remporte le pli.`;
  }
  if (pub.phase === 'round-over') banner = 'Manche terminée.';

  return (
    <section
      className="player-game fade-in cards-player trick-player"
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Manche {pub.round} · {pub.scores[playerId] ?? 0} pts · {pub.tricksWon[playerId] ?? 0} plis
        {trump ? ` · atout ${trump}` : ''}
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${myTurn ? ' is-mine' : ''}`}>{banner}</p>

      {pub.table.length > 0 && (
        <div className="trick-mini-row">
          {pub.table.map((t) => {
            const entry = entryOf(pub.def, t.entry);
            return (
              <div key={t.pid} className="trick-mini">
                <CardFace def={pub.def} entry={entry} label={`${pub.names[t.pid] ?? '?'} : ${entry?.label ?? ''}`} />
              </div>
            );
          })}
        </div>
      )}

      <div className="pick-hand">
        {hand.map((card) => {
          const entry = entryOf(pub.def, card.entry);
          const label = entry ? entry.label || entry.text?.slice(0, 40) || entry.symbol : 'Carte';
          return (
            <button
              key={card.uid}
              type="button"
              className="pick-card"
              disabled={!myTurn || !playable.has(card.uid)}
              aria-label={label}
              onClick={() => void playCard(card.uid)}
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
