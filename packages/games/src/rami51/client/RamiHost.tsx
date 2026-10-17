import { useRef } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from '../../cards/client/CardFace.js';
import { useCardFlights, useChange } from '../../cards/client/cues.js';
import { RAMI_DEFINITION, cardName, jokerText, meldPoints, meldTitle, type Meld } from '../rules.js';
import { ramiEntry, ramiRanking, type RamiPub } from './common.js';

/** Une combinaison posée : titre, points, cartes dans l’ordre (le joker indique la carte qu’il remplace). */
function MeldView({ meld }: { meld: Meld }) {
  return (
    <div className="rami-meld">
      <div className="rami-meld-head">
        <b>{meldTitle(meld.kind, meld.cards)}</b>
        <span className="muted small">{meldPoints(meld.cards)} pts</span>
      </div>
      <div className="rami-meld-cards">
        {meld.cards.map((c) => (
          <div
            key={c.uid}
            className={`rami-mc${c.entry === 'jk' ? ' is-joker' : ''}`}
            data-uid={c.uid}
            data-zone="table"
          >
            <div data-fly-target>
              <CardFace def={RAMI_DEFINITION} entry={ramiEntry(c.entry)} label={cardName(c.entry)} />
            </div>
            {c.entry === 'jk' && <span className="rami-mc-tag">= {jokerText(c)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Écran principal du Rami 51 : combinaisons par joueur sur le tapis, pioche, défausse et sièges. */
export function RamiHost({ publicState, now }: HostViewProps) {
  const pub = publicState as RamiPub | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);
  const rootRef = useRef<HTMLElement>(null);

  // Sons et trajets : déclenchés par les changements d’état, avant les retours anticipés.
  useChange(pub?.started ?? false, (_, started) => {
    if (started) play('start');
  });
  useChange(pub?.discardTop?.uid ?? null, (before, after) => {
    if (before !== null && after) play('card');
  });
  useChange(pub?.melds.length ?? 0, (before, after) => {
    if (after > before) play('card');
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
        title="Rami 51 : en attente du lancement…"
        text={`${pub.order.length} joueur(s) · ouverture à ${pub.settings.openingPoints} points · objectif ${pub.settings.targetScore} points`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={ramiRanking(pub)} />;

  const current = pub.current ? pub.names[pub.current] : null;
  const result = pub.result;
  const owners = pub.order.filter((id) => pub.melds.some((m) => m.owner === id));

  return (
    <section
      ref={rootRef}
      className={`cards-host rami-host fade-in phase-${pub.phase}`}
      key={`r-${pub.round}`}
      data-mat="classique"
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">Manche {pub.round}</span>
        <span className="hud-pill">Objectif {pub.settings.targetScore} pts</span>
        <span className="hud-pill">Ouverture {pub.settings.openingPoints} pts</span>
        <SoundToggle />
      </div>

      <div className="cards-seats">
        {pub.order.map((id) => {
          const name = pub.names[id] ?? '?';
          const cls = [
            'seat-card',
            pub.current === id ? 'is-turn' : '',
            pub.roundWinner === id && pub.phase !== 'play' ? 'is-winner' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={id} className={cls} data-seat={id}>
              <Avatar name={name} size="sm" />
              <div className="seat-meta">
                <span className="seat-name">
                  {name}
                  {pub.dealer === id && (
                    <span className="dealer-btn" title="Donneur" role="img" aria-label="Donneur">
                      D
                    </span>
                  )}
                </span>
                <span className="seat-score">
                  {pub.opened[id] ? 'Ouvert' : 'Pas ouvert'} · {pub.scores[id] ?? 0} pts
                </span>
              </div>
              <span className="seat-count" role="img" aria-label={`${pub.counts[id] ?? 0} cartes en main`}>
                <b>{pub.counts[id] ?? 0}</b>
                <span className="muted small">cartes</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="rami-felt table-mat">
        <div className="rami-stock">
          <div className="cards-pile" role="img" aria-label={`${pub.drawCount} cartes en pioche`}>
            <div className="pile-back">
              <CardFace def={RAMI_DEFINITION} back />
            </div>
            <span className="pile-count">{pub.drawCount}</span>
          </div>
          <div className="cards-discard" role="group" aria-label="Défausse">
            {pub.discardTop && (
              <div className="discard-card" key={pub.discardTop.uid} data-uid={pub.discardTop.uid} data-zone="table">
                <CardFace
                  def={RAMI_DEFINITION}
                  entry={ramiEntry(pub.discardTop.entry)}
                  label={cardName(pub.discardTop.entry)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="rami-melds" role="group" aria-label="Combinaisons posées">
          {owners.length === 0 ? (
            <p className="rami-empty">Aucune combinaison posée.</p>
          ) : (
            owners.map((id) => (
              <div key={id} className="rami-owner">
                <h3 className="rami-owner-name">{pub.names[id]}</h3>
                <div className="rami-owner-melds">
                  {pub.melds
                    .filter((m) => m.owner === id)
                    .map((m) => (
                      <MeldView key={m.id} meld={m} />
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {pub.phase === 'play' && pub.settings.turnSeconds > 0 && (
        <TimerBar remaining={remaining} total={pub.settings.turnSeconds * 1000} />
      )}

      <p className="cards-event" aria-live="polite">
        {pub.lastEvent}
        {current && pub.phase === 'play' && <> · À {current} de jouer</>}
      </p>

      {pub.phase === 'round-over' && result && (
        <div className="cards-reveal">
          <h3>
            Mains restantes et pénalités
            {result.ramiSec && <span className="hud-pill rami-sec">Rami sec : pénalités doublées</span>}
          </h3>
          <div className="reveal-hands">
            {pub.order.map((id) => (
              <div key={id} className="reveal-hand">
                <span className="seat-name">{pub.names[id]}</span>
                <span className="mini-row">
                  {(result.hands[id] ?? []).map((c, idx) => (
                    <span key={c.uid} className="mini-card" style={{ ['--i' as string]: idx }}>
                      <CardFace def={RAMI_DEFINITION} entry={ramiEntry(c.entry)} label={cardName(c.entry)} />
                    </span>
                  ))}
                  {(result.hands[id] ?? []).length === 0 && <span className="muted">Main vide</span>}
                </span>
                <span className={id === result.winner ? 'rami-ok' : 'muted'}>
                  {id === result.winner ? 'A terminé · 0' : `+${result.penalties[id] ?? 0} pts`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
