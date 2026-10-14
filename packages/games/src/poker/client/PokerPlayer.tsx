import { useEffect, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { Ranking } from '../../client/ui.js';
import { play, unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from '../../cards/client/CardFace.js';
import { cueTurn, useChange } from '../../cards/client/cues.js';
import { entryOf } from '../../cards/client/common.js';
import { POKER_DEFINITION, evaluateBest } from '../rules.js';
import { STREET_LABEL, chipsRanking, fmt, type PokerMe, type PokerPub } from './common.js';

/** Téléphone du poker : deux cartes privées, le tableau, et les mises. */
export function PokerPlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as PokerPub | null;
  const me = playerState as PokerMe | null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(0);

  const myTurn = !!me?.isMyTurn;
  const iWon = !!pub?.winners.some((w) => w.id === playerId);

  // Sons et vibration : déclenchés par les changements d'état, avant les retours anticipés.
  useChange(myTurn, (_, mine) => {
    if (mine) cueTurn();
  });
  useChange(pub?.board.length ?? 0, (before, after) => {
    if (after > before) play('card');
  });
  useChange(pub?.handNumber ?? 0, (before, after) => {
    if (before > 0 && after > before) play('draw');
  });
  useChange(iWon, (_, won) => {
    if (won) play('win');
  });

  // Le panneau de relance se referme quand ce n'est plus votre tour.
  useEffect(() => {
    if (!myTurn) setRaiseOpen(false);
    setError(null);
  }, [myTurn, pub?.handNumber]);

  if (!pub) return null;

  if (pub.phase === 'final') {
    const ranking = chipsRanking(pub);
    return (
      <section className="player-game fade-in cards-player">
        <p className="big">Partie terminée</p>
        <p className="big-number">{fmt(pub.stacks[playerId] ?? 0)} jetons</p>
        <Ranking entries={ranking} limit={4} />
      </section>
    );
  }

  if (!pub.started) {
    return (
      <section className="player-game fade-in">
        <p className="big">Préparez-vous !</p>
        <p className="muted">
          Chacun commence avec {fmt(pub.settings.startingChips)} jetons. Gardez vos cartes à l’abri des regards.
        </p>
      </section>
    );
  }

  if (!me || (me.spectator && (pub.stacks[playerId] ?? 0) > 0)) {
    return (
      <section className="player-game fade-in">
        <p className="big">Partie en cours</p>
        <p className="muted">Vous observez cette partie.</p>
      </section>
    );
  }

  async function run(type: string, payload?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Action refusée.');
      return;
    }
    setRaiseOpen(false);
    if (type !== 'fold' && type !== 'check') play('chip');
  }

  function openRaise() {
    if (!me) return;
    setAmount(me.minRaiseTo);
    setRaiseOpen(true);
  }

  const clamp = (n: number) => (me ? Math.max(me.minRaiseTo, Math.min(me.maxRaiseTo, Math.round(n))) : n);
  const eliminated = me.spectator && (pub.stacks[playerId] ?? 0) === 0;
  const winnerText = pub.winners
    .map((w) => (w.id === playerId ? `Vous gagnez ${fmt(w.amount)}` : `${w.name} gagne ${fmt(w.amount)}`))
    .join(' · ');

  const banner =
    pub.phase === 'hand-over'
      ? winnerText || 'Main terminée'
      : eliminated
        ? 'Vous êtes éliminé'
        : me.folded
          ? 'Vous êtes couché'
          : myTurn
            ? me.canCheck
              ? 'À vous : checkez ou misez'
              : `À vous : ${fmt(me.callAmount)} pour suivre`
            : `Tour de ${pub.current ? pub.names[pub.current] : '…'}`;

  // Force actuelle de la main, calculée sur le téléphone dès le flop (rien n'est envoyé au serveur).
  const strength =
    me.hole.length === 2 && pub.board.length >= 3
      ? evaluateBest([...me.hole.map((c) => c.uid), ...pub.board]).name
      : null;

  const halfPot = clamp(pub.currentBet + pub.pot / 2);
  const fullPot = clamp(pub.currentBet + pub.pot);
  const isAllInAmount = amount >= me.maxRaiseTo;

  return (
    <section
      className="player-game fade-in cards-player poker-player"
      data-mat="classique"
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Main n°{pub.handNumber} · {STREET_LABEL[pub.street]}
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${myTurn ? ' is-mine' : ''}`}>{banner}</p>

      <div className="poker-stats">
        <span className="hud-pill">Pile {fmt(me.stack)}</span>
        <span className="hud-pill">Mise {fmt(me.bet)}</span>
        <span className="hud-pill">
          <span className="chip-dot" aria-hidden="true" />
          Pot {fmt(pub.pot)}
        </span>
      </div>

      <div className="table-mat hand-mat poker-hand">
        {me.hole.length > 0 ? (
          <div className={`poker-hole${me.folded ? ' is-folded' : ''}`} aria-label="Vos cartes">
            {me.hole.map((c, i) => (
              <span key={c.uid} className="poker-hole-card" style={{ ['--i' as string]: i }}>
                <CardFace def={POKER_DEFINITION} entry={entryOf(POKER_DEFINITION, c.entry)} />
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">{eliminated ? 'Plus de jetons : vous suivez la fin de partie.' : 'Pas de cartes pour cette main.'}</p>
        )}
        {pub.board.length > 0 && (
          <div className="poker-mini-board" aria-label="Cartes communes">
            {pub.board.map((c) => (
              <span key={c} className="mini-card">
                <CardFace def={POKER_DEFINITION} entry={entryOf(POKER_DEFINITION, c)} />
              </span>
            ))}
          </div>
        )}
        {strength && <p className="poker-strength">Votre main : {strength}</p>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {raiseOpen && myTurn && (
        <div className="poker-raise" role="group" aria-label="Relance">
          <label className="poker-raise-amount">
            <span>Relancer à</span>
            <b>{fmt(amount)}</b>
          </label>
          <input
            type="range"
            min={me.minRaiseTo}
            max={me.maxRaiseTo}
            step={Math.max(1, pub.settings.smallBlind)}
            value={amount}
            onChange={(e) => setAmount(clamp(Number(e.target.value)))}
            aria-label="Montant de la relance"
          />
          <div className="poker-quick">
            <button type="button" className="btn ghost" onClick={() => setAmount(me.minRaiseTo)}>
              Min
            </button>
            <button type="button" className="btn ghost" onClick={() => setAmount(halfPot)}>
              ½ pot
            </button>
            <button type="button" className="btn ghost" onClick={() => setAmount(fullPot)}>
              Pot
            </button>
            <button type="button" className="btn ghost" onClick={() => setAmount(me.maxRaiseTo)}>
              Tapis
            </button>
          </div>
          <button
            type="button"
            className="btn primary big"
            disabled={busy}
            onClick={() => void (isAllInAmount ? run('allin') : run('raise', { to: amount }))}
          >
            {isAllInAmount ? `Tapis (${fmt(me.maxRaiseTo)})` : `Relancer à ${fmt(amount)}`}
          </button>
        </div>
      )}

      {pub.phase === 'play' && !me.folded && me.hole.length > 0 && (
        <div className="control-dock cards-dock poker-dock">
          <button type="button" className="btn ghost big" disabled={busy || !myTurn} onClick={() => void run('fold')}>
            Se coucher
          </button>
          {me.canCall ? (
            <button type="button" className="btn primary big" disabled={busy || !myTurn} onClick={() => void run('call')}>
              {me.callAmount >= me.stack ? `Tapis ${fmt(me.callAmount)}` : `Suivre ${fmt(me.callAmount)}`}
            </button>
          ) : (
            <button type="button" className="btn primary big" disabled={busy || !myTurn} onClick={() => void run('check')}>
              Checker
            </button>
          )}
          <button
            type="button"
            className="btn ghost big"
            disabled={busy || !myTurn || !me.canRaise}
            aria-expanded={raiseOpen}
            onClick={() => (raiseOpen ? setRaiseOpen(false) : openRaise())}
          >
            {pub.currentBet > 0 ? 'Relancer' : 'Miser'}
          </button>
        </div>
      )}
    </section>
  );
}
