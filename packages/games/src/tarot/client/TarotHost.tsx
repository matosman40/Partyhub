import { useRef } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { useCardFlights, useChange } from '../../cards/client/cues.js';
import { CONTRACT_LABEL } from '../rules.js';
import { seatPos, tarotRanking, type TarotPub } from './common.js';
import { MiniCard, MiniRow, SummaryPanel, TarotCard, contractText } from './parts.js';

/** Écran principal du tarot : quatre places autour du tapis, le pli au centre, le contrat en haut. */
export function TarotHost({ publicState, now }: HostViewProps) {
  const pub = publicState as TarotPub | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);
  const rootRef = useRef<HTMLElement>(null);

  // Sons et trajets : déclenchés par les changements d'état, avant les retours anticipés.
  useChange(pub?.started ?? false, (_, started) => {
    if (started) play('start');
  });
  useChange((pub?.trickCount ?? 0) * 4 + (pub?.trick.length ?? 0), (before, after) => {
    if (after > before) play('card');
  });
  useChange(pub?.dealCount ?? 0, (before, after) => {
    if (before > 0 && after > before) play('draw');
  });
  useChange(pub?.phase ?? '', (_, phase) => {
    if (phase === 'final') play('final');
    else if (phase === 'round-over') play('win');
  });
  useCardFlights(rootRef);

  if (!pub) return null;

  if (!pub.started) {
    return (
      <WaitingScreen
        title="Tarot : en attente du lancement…"
        text={`${pub.order.length} joueur(s) sur 4 · ${pub.rounds} donne(s)`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={tarotRanking(pub)} />;

  const takerName = pub.taker ? pub.names[pub.taker] : null;
  const currentName = pub.current ? pub.names[pub.current] : null;
  const active = pub.phase === 'bidding' || pub.phase === 'ecart' || pub.phase === 'play';
  const total = pub.settings.turnSeconds * 1000 * (pub.phase === 'ecart' ? 2 : 1);

  return (
    <section
      ref={rootRef}
      className={`cards-host tarot-host fade-in phase-${pub.phase}`}
      key={`d-${pub.dealCount}`}
      data-mat="classique"
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">
          Donne {pub.round} / {pub.rounds}
        </span>
        {pub.taker && pub.contract && (
          <span className="hud-pill tarot-contract">
            {takerName} prend : {contractText(pub.contract)}
          </span>
        )}
        {pub.taker && pub.phase === 'play' && (
          <span className="hud-pill">
            Plis : preneur {pub.tricks.attack}, défense {pub.tricks.defence}
          </span>
        )}
        <SoundToggle />
      </div>

      {pub.phase === 'round-over' ? (
        <SummaryPanel pub={pub} />
      ) : (
        <>
          {pub.ecartAtouts.length > 0 && (
            <div className="tarot-ecart">
              <span className="muted small">Atouts à l’écart</span>
              <MiniRow ids={pub.ecartAtouts} label="Atouts mis à l’écart" />
            </div>
          )}

          <div className="tarot-board">
            {pub.order.map((id) => (
              <Seat key={id} pub={pub} id={id} />
            ))}
            <div className="tarot-center table-mat">
              <Center pub={pub} />
            </div>
          </div>

          {active && total > 0 && <TimerBar remaining={remaining} total={total} />}
        </>
      )}

      <p className="cards-event" aria-live="polite">
        {pub.lastEvent}
        {currentName && active && pub.phase !== 'ecart' && (
          <>
            {' '}
            · À {currentName} {pub.phase === 'bidding' ? 'd’annoncer' : 'de jouer'}
          </>
        )}
      </p>
    </section>
  );
}

/** Texte sous le nom : l'enchère pendant les enchères, puis le camp. */
function seatNote(pub: TarotPub, id: string): string {
  if (pub.phase === 'bidding') {
    const bid = pub.bids.find((b) => b.playerId === id);
    if (bid) return bid.contract ? CONTRACT_LABEL[bid.contract] : 'Passe';
    return pub.current === id ? 'Réfléchit…' : '';
  }
  if (pub.phase === 'ecart' && pub.taker === id) return 'Fait son écart';
  if (pub.taker === id) return 'Preneur';
  if (pub.taker) return 'Défense';
  return '';
}

function Seat({ pub, id }: { pub: TarotPub; id: string }) {
  const name = pub.names[id] ?? '?';
  const pos = seatPos(pub, id);
  const note = seatNote(pub, id);
  const leads = pub.phase === 'play' && pub.trick.length === 0 && pub.leader === id;
  const cls = [
    'seat-card',
    'tarot-seat',
    `pos-${pos}`,
    pub.current === id ? 'is-turn' : '',
    pub.taker === id ? 'is-taker' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} data-seat={id}>
      <Avatar name={name} size="sm" />
      <div className="seat-meta">
        <span className="seat-name">
          {name}
          {pub.dealer === id && (
            <span className="tarot-dealer" title="Donneur" role="img" aria-label="Donneur">
              D
            </span>
          )}
        </span>
        <span className="seat-score">{pub.scores[id] ?? 0} pts</span>
        {(note || leads) && <span className="tarot-seat-note">{leads ? 'Entame' : note}</span>}
      </div>
      <span className="seat-count" role="img" aria-label={`${pub.counts[id] ?? 0} cartes en main`}>
        <b>{pub.counts[id] ?? 0}</b>
        <span className="muted small">cartes</span>
      </span>
    </div>
  );
}

/** Centre du tapis : enchères, chien retourné pendant l'écart, ou le pli (le dernier pli une fois ramassé). */
function Center({ pub }: { pub: TarotPub }) {
  if (pub.phase === 'bidding') {
    const best = pub.highest ? pub.bids.find((b) => b.contract === pub.highest) : null;
    return (
      <div className="tarot-notice" aria-live="polite">
        <p className="tarot-notice-title">Enchères</p>
        <p>
          {best
            ? `${pub.names[best.playerId]} mène avec une ${CONTRACT_LABEL[pub.highest!]}.`
            : 'Personne n’a encore annoncé.'}
        </p>
        <p className="muted small">Un seul tour : passer, ou annoncer plus haut que l’enchère précédente.</p>
      </div>
    );
  }

  if (pub.phase === 'ecart') {
    return (
      <div className="tarot-notice">
        <p className="tarot-notice-title">Le chien{pub.taker ? ` de ${pub.names[pub.taker]}` : ''}</p>
        <span className="tarot-chien" role="group" aria-label="Le chien, retourné">
          {(pub.chien ?? []).map((id) => (
            <MiniCard key={id} id={id} className="is-big" />
          ))}
        </span>
        <p className="muted small">Le preneur le prend en main et écarte six cartes.</p>
      </div>
    );
  }

  const done = pub.trick.length === 0 && pub.lastTrick !== null;
  const cards = pub.trick.length > 0 ? pub.trick : (pub.lastTrick?.cards ?? []);
  const winner = done ? pub.lastTrick!.winner : null;

  return (
    <div className="tarot-trick" role="group" aria-label={done ? 'Dernier pli' : 'Pli en cours'}>
      {cards.map((c) => (
        <div
          key={c.cardId}
          className={`tarot-slot pos-${seatPos(pub, c.playerId)}${winner === c.playerId ? ' is-winner' : ''}`}
          data-uid={c.cardId}
          data-zone="table"
        >
          <div className="tarot-slot-face" data-fly-target>
            <TarotCard id={c.cardId} />
          </div>
        </div>
      ))}
      {cards.length === 0 && (
        <p className="tarot-notice-title tarot-trick-empty">{pub.leader ? `${pub.names[pub.leader]} entame` : ''}</p>
      )}
      {winner && <p className="tarot-won">{pub.names[winner]} remporte le pli</p>}
    </div>
  );
}
