import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { Ranking, TimerBar } from '../../client/ui.js';
import { useRemaining } from '../../client/hooks.js';
import { play as playSound, unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { cueTurn, useCardFlights, useChange } from '../../cards/client/cues.js';
import {
  CHIEN_SIZE,
  CONTRACTS,
  CONTRACT_COEF,
  CONTRACT_LABEL,
  autoEcart,
  cardName,
  ecartCardError,
  ecartError,
  playError,
  sortHand,
} from '../rules.js';
import { signed, tarotRanking, type TarotMe, type TarotPub } from './common.js';
import { HandRows, MiniRow, SummaryPanel, TarotCard, contractText } from './parts.js';

const NO_IDS: readonly string[] = [];

/** Téléphone du tarot : enchères, écart du preneur, puis les cartes à jouer. */
export function TarotPlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as TarotPub | null;
  const me = playerState as TarotMe | null;
  const [selected, setSelected] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

  const phase = pub?.phase;
  const myTurn = !!me?.isMyTurn && (phase === 'bidding' || phase === 'ecart' || phase === 'play');
  const hand = useMemo(() => sortHand((me?.hand ?? []).map((c) => c.uid)), [me?.hand]);
  const playable = useMemo(() => new Set(me?.playable ?? NO_IDS), [me?.playable]);

  // La sélection repart à zéro dès que le jeu avance ; une seule carte permise est déjà choisie.
  useEffect(() => {
    setSelected([]);
    setError(null);
    setPicked(phase === 'play' && me?.isMyTurn && me.playable.length === 1 ? me.playable[0]! : null);
  }, [phase, pub?.dealCount, pub?.trickCount, pub?.trick.length, pub?.current, me?.isMyTurn]);

  // Sons, vibration et trajets : déclenchés par les changements d'état (avant les retours anticipés).
  useChange(myTurn, (_, mine) => {
    if (mine) cueTurn();
  });
  useChange((pub?.trickCount ?? 0) * 4 + (pub?.trick.length ?? 0), (before, after) => {
    if (after > before) playSound('card');
  });
  useChange(pub?.dealCount ?? 0, (before, after) => {
    if (before > 0 && after > before) playSound('draw');
  });
  useChange(hand.length, (before, after) => {
    if (before > 0 && after > before) playSound('draw');
  });
  useChange(phase ?? '', (_, next) => {
    if (next === 'final') playSound('final');
    else if (next === 'round-over' && (pub?.summary?.deltas[playerId] ?? 0) > 0) playSound('win');
  });
  useCardFlights(rootRef);

  if (!pub) return null;

  if (pub.phase === 'final') {
    const rank = tarotRanking(pub);
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
        <p className="muted">
          Le tarot se joue à quatre : un preneur contre trois défenseurs. Gardez vos cartes à l’abri des regards.
        </p>
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

  const name = (id: string | null) => (id ? (pub.names[id] ?? '?') : '');
  const trickIds = pub.trick.map((p) => p.cardId);
  const isTaker = pub.taker === playerId;

  async function run(type: string, payload?: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée.');
    return res.ok;
  }

  // --- Écart : on choisit six cartes, validées en direct par les mêmes règles que le serveur.
  function tapEcart(uid: string) {
    if (!me?.mustEcart) return;
    setError(null);
    if (selected.includes(uid)) {
      setSelected(selected.filter((id) => id !== uid));
      return;
    }
    const blocked = ecartCardError(hand, uid);
    if (blocked) {
      setError(blocked);
      return;
    }
    if (selected.length >= CHIEN_SIZE) {
      setError(`L’écart compte exactement ${CHIEN_SIZE} cartes : retirez-en une avant d’en ajouter.`);
      return;
    }
    setSelected([...selected, uid]);
  }

  const ecartProblem = me.mustEcart ? ecartError(hand, selected) : null;
  const canConfirmEcart = me.mustEcart && selected.length === CHIEN_SIZE && ecartProblem === null;

  // --- Jeu : un premier toucher choisit la carte, un second (ou le bouton) la joue.
  function tapPlay(uid: string) {
    if (!me?.isMyTurn) {
      setError('Ce n’est pas votre tour.');
      return;
    }
    const problem = playError(hand, trickIds, uid);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (picked === uid) void playCard(uid);
    else setPicked(uid);
  }

  async function playCard(uid: string) {
    if (busy) return;
    setPendingUid(uid);
    const done = await run('play', { cardId: uid });
    setPendingUid(null);
    if (done) setPicked(null);
  }

  let banner = `Tour de ${name(pub.current)}`;
  if (pub.phase === 'round-over') banner = 'Donne terminée';
  else if (pub.phase === 'bidding')
    banner = me.isMyTurn ? 'À vous d’annoncer' : `Enchères : ${name(pub.current)} parle`;
  else if (pub.phase === 'ecart') banner = me.mustEcart ? 'Faites votre écart' : `${name(pub.taker)} fait son écart`;
  else if (me.isMyTurn) banner = pub.trick.length === 0 ? 'À vous d’entamer' : 'À vous de jouer';

  const fromChien = new Set<string>(pub.phase === 'ecart' && isTaker ? (pub.chien ?? NO_IDS) : NO_IDS);
  const locked = new Set<string>(me.mustEcart ? hand.filter((id) => ecartCardError(hand, id) !== null) : NO_IDS);
  const sideText = pub.taker ? (isTaker ? 'Vous êtes le preneur' : 'Vous êtes en défense') : '';
  const total = pub.settings.turnSeconds * 1000 * (pub.phase === 'ecart' ? 2 : 1);
  const showDock = pub.phase === 'bidding' || me.mustEcart || pub.phase === 'play';

  return (
    <section
      ref={rootRef}
      className="player-game fade-in cards-player tarot-player"
      data-mat="classique"
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Donne {pub.round} / {pub.rounds}
        {pub.contract && pub.taker ? ` · ${name(pub.taker)} : ${contractText(pub.contract)}` : ''}
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${me.isMyTurn && pub.phase !== 'round-over' ? ' is-mine' : ''}`}>{banner}</p>
      {pub.phase !== 'round-over' && total > 0 && pub.current && <TimerBar remaining={remaining} total={total} />}

      {pub.phase === 'round-over' ? (
        <>
          <p className="muted">
            La donne suivante démarre bientôt.{' '}
            {pub.summary && <b>Vous marquez {signed(pub.summary.deltas[playerId] ?? 0)}.</b>}
          </p>
          <SummaryPanel pub={pub} compact playerId={playerId} />
        </>
      ) : (
        <>
          {pub.phase === 'bidding' && (
            <ul className="tarot-bids" aria-label="Enchères">
              {pub.order.map((id) => {
                const bid = pub.bids.find((b) => b.playerId === id);
                return (
                  <li key={id} className={bid?.contract ? 'is-bid' : undefined}>
                    <span className="tarot-bid-name">{id === playerId ? 'Vous' : name(id)}</span>
                    <span>
                      {bid ? (bid.contract ? CONTRACT_LABEL[bid.contract] : 'Passe') : pub.current === id ? '…' : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {pub.phase === 'ecart' && pub.chien && (
            <div className="tarot-ecart">
              <span className="muted small">Le chien{isTaker ? ' (dans votre main, repéré d’un trait doré)' : ''}</span>
              <MiniRow ids={pub.chien} label="Le chien" />
            </div>
          )}

          {pub.phase === 'play' && (
            <div className="table-mat tarot-phone-trick">
              <div className="tarot-strip" role="group" aria-label="Pli en cours">
                {pub.order.map((id) => {
                  const card = pub.trick.find((p) => p.playerId === id)?.cardId;
                  return (
                    <div key={id} className="tarot-strip-cell">
                      <div className="tarot-strip-slot">
                        {card && (
                          <div className="tarot-strip-card" data-uid={card} data-zone="table">
                            <div data-fly-target>
                              <TarotCard id={card} />
                            </div>
                          </div>
                        )}
                      </div>
                      <span className={`tarot-strip-name${pub.current === id ? ' is-turn' : ''}`}>
                        {id === playerId ? 'Vous' : name(id)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="tarot-strip-info">
                {sideText} · Plis : preneur {pub.tricks.attack}, défense {pub.tricks.defence}
              </p>
            </div>
          )}

          {pub.phase === 'play' && pub.ecartAtouts.length > 0 && (
            <div className="tarot-ecart">
              <span className="muted small">Atouts à l’écart</span>
              <MiniRow ids={pub.ecartAtouts} label="Atouts mis à l’écart" />
            </div>
          )}

          <div className="table-mat hand-mat tarot-hand-mat">
            <HandRows
              ids={hand}
              mode={pub.phase === 'play' ? 'play' : 'select'}
              waiting={pub.phase === 'play' && !me.isMyTurn}
              disabled={busy || (pub.phase !== 'play' && !me.mustEcart)}
              onTap={me.mustEcart ? tapEcart : tapPlay}
              playable={me.mustEcart ? undefined : playable}
              selected={me.mustEcart ? selected : picked ? [picked] : NO_IDS}
              locked={locked}
              fromChien={fromChien}
              pendingUid={pendingUid}
            />
          </div>

          {me.mustEcart && (
            <p className="muted small tarot-count" aria-live="polite">
              {selected.length} / {CHIEN_SIZE} cartes à l’écart
              {ecartProblem && selected.length === CHIEN_SIZE ? ` : ${ecartProblem}` : ''}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}

      {showDock && (
        <div className={`control-dock cards-dock tarot-dock${pub.phase === 'bidding' ? ' is-bids' : ''}`}>
          {pub.phase === 'bidding' && (
            <>
              {CONTRACTS.map((contract) => (
                <button
                  key={contract}
                  type="button"
                  className="btn primary big"
                  disabled={busy || !me.bidOptions.includes(contract)}
                  onClick={() => void run('bid', { contract })}
                >
                  {CONTRACT_LABEL[contract]}
                  <small> ×{CONTRACT_COEF[contract]}</small>
                </button>
              ))}
              <button
                type="button"
                className="btn ghost big"
                disabled={busy || !me.canPass}
                onClick={() => void run('pass')}
              >
                Passer
              </button>
            </>
          )}
          {me.mustEcart && (
            <>
              <button
                type="button"
                className="btn ghost big"
                disabled={busy}
                onClick={() => setSelected(autoEcart(hand))}
              >
                Choisir pour moi
              </button>
              <button
                type="button"
                className="btn primary big"
                disabled={busy || !canConfirmEcart}
                onClick={() => void run('ecart', { cardIds: selected })}
              >
                Confirmer l’écart
              </button>
            </>
          )}
          {pub.phase === 'play' && (
            <button
              type="button"
              className="btn primary big"
              disabled={busy || !me.isMyTurn || !picked}
              onClick={() => picked && void playCard(picked)}
            >
              {picked
                ? `Jouer ${cardName(picked).toLowerCase()}`
                : me.isMyTurn
                  ? 'Touchez une carte'
                  : 'Attendez votre tour'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
