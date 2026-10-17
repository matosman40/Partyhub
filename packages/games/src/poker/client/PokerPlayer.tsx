import { useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Ranking } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { cueTurn, useChange } from '../../cards/client/cues.js';
import { rankingOf } from '../../cards/client/common.js';
import { ChipStack, PokerCardFace } from './PokerCards.js';
import type { PokerPlayerState, PokerPublic } from './common.js';

/** Téléphone du poker : ses deux cartes, ses jetons, et les actions possibles à son tour. */
export function PokerPlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as PokerPublic | null;
  const me = playerState as PokerPlayerState | null;
  const [raise, setRaise] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

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
        <p className="big-number">{mine?.points ?? 0} jetons</p>
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
        <p className="muted">Vous observez cette partie.</p>
      </section>
    );
  }

  const myTurn = me.isMyTurn;
  const minTo = me.minRaiseTo;
  const maxTo = me.maxRaiseTo;
  const amount = Math.min(maxTo, Math.max(minTo, raise ?? minTo));

  async function act(type: string, payload?: unknown) {
    if (pending.current || !myTurn) return;
    pending.current = true;
    setError(null);
    const res = await send(type, payload);
    pending.current = false;
    if (res.ok) setRaise(null);
    else setError(res.error ?? 'Action refusée.');
  }

  const mineWon = pub.result?.winners.find((w) => w.pid === playerId);
  let banner = pub.current ? `Tour de ${pub.names[pub.current] ?? '…'}` : 'En attente de la donne…';
  if (myTurn) banner = me.toCall > 0 ? `À vous : ${me.toCall} jetons pour suivre.` : 'À vous : parole ou relance ?';
  else if (me.folded) banner = 'Vous êtes couché(e) pour cette donne.';
  else if (pub.phase === 'hand-over') {
    banner = mineWon ? `Vous gagnez ${mineWon.amount} jetons !` : 'Donne terminée.';
  }
  if (me.chips === 0 && !me.holes.length && pub.phase === 'betting') {
    banner = 'Vous n’avez plus de jetons : vous observez la suite.';
  }

  const holes = me.holes;
  return (
    <section className="player-game fade-in cards-player poker-player" onPointerDownCapture={() => unlockAudio()}>
      <div className="round-info">
        Donne {pub.hand} · {me.chips} jetons{me.bet > 0 ? ` · mise ${me.bet}` : ''}
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${myTurn ? ' is-mine' : ''}`}>{banner}</p>

      {pub.phase === 'betting' && pub.turnEndsAt !== null && pub.settings.turnSeconds > 0 && (
        <p className="muted poker-clock">{Math.ceil(remaining / 1000)} s pour agir</p>
      )}

      <div className="poker-hole" role="group" aria-label="Vos cartes">
        {holes.length > 0 ? (
          holes.map((card, i) => <PokerCardFace key={i} card={card} />)
        ) : (
          <>
            <PokerCardFace empty />
            <PokerCardFace empty />
          </>
        )}
      </div>

      <div className="poker-board-mini" role="group" aria-label="Cartes communes">
        {[0, 1, 2, 3, 4].map((i) => {
          const card = pub.board[i];
          return card ? <PokerCardFace key={i} card={card} small /> : <PokerCardFace key={i} small empty />;
        })}
      </div>

      <div className="poker-pot-line">
        Pot {pub.pot}
        {pub.pot > 0 && <ChipStack amount={pub.pot} />}
        {pub.currentBet > 0 && <span> · mise à suivre : {pub.currentBet}</span>}
      </div>

      {myTurn && (
        <div className="poker-actions">
          <button type="button" className="btn ghost" onClick={() => void act('fold')}>
            Se coucher
          </button>
          {me.canCheck ? (
            <button type="button" className="btn primary" onClick={() => void act('check')}>
              Parole
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={!me.canCall} onClick={() => void act('call')}>
              {me.callAmount < me.toCall ? `Suivre (tapis ${me.callAmount})` : `Suivre ${me.callAmount}`}
            </button>
          )}
        </div>
      )}

      {myTurn && me.canRaise && (
        <div className="poker-raise">
          <div className="poker-presets">
            <button type="button" className="btn ghost" onClick={() => setRaise(minTo)}>
              Minimum
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setRaise(Math.min(maxTo, Math.max(minTo, Math.round(pub.pot / 2))))}
            >
              ½ pot
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setRaise(Math.min(maxTo, Math.max(minTo, pub.pot)))}
            >
              Pot
            </button>
          </div>
          <input
            type="range"
            min={minTo}
            max={maxTo}
            step={1}
            value={amount}
            aria-label="Montant de la relance"
            onChange={(e) => setRaise(Number(e.target.value))}
          />
          <div className="poker-raise-row">
            <button type="button" className="btn primary" onClick={() => void act('bet', { amount })}>
              {pub.currentBet > 0 ? `Relancer à ${amount}` : `Miser ${amount}`}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={maxTo <= pub.currentBet}
              onClick={() => void act('allin')}
            >
              Tapis ({maxTo})
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
