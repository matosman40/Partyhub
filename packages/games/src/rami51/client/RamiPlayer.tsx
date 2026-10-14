import { useEffect, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { Ranking } from '../../client/ui.js';
import { play as playSound, unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from '../../cards/client/CardFace.js';
import { HandFan } from '../../cards/client/HandFan.js';
import { cueTurn, useChange } from '../../cards/client/cues.js';
import {
  RAMI_DEFINITION,
  cardLabel,
  cardName,
  checkLayoff,
  checkMeld,
  checkOpening,
  checkSwap,
  jokerText,
  meldTitle,
  sortCards,
  type Meld,
  type RamiCard,
  type SortMode,
} from '../rules.js';
import { ramiEntry, ramiRanking, type RamiMe, type RamiPub } from './common.js';

type Mode = 'layoff' | 'swap' | null;

const labels = (cards: readonly { entry: string }[]) => cards.map((c) => cardLabel(c.entry)).join(' ');

/** Téléphone du Rami 51 : la main, les combinaisons à préparer, et les actions du tour. */
export function RamiPlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as RamiPub | null;
  const me = playerState as RamiMe | null;
  const [selected, setSelected] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[][]>([]);
  const [sort, setSort] = useState<SortMode>('suit');
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myTurn = !!me?.isMyTurn && pub?.phase === 'play';
  const handKey = (me?.hand ?? []).map((c) => c.uid).join(',');

  // Tout repart à zéro quand le tour ou la manche change.
  useEffect(() => {
    setSelected([]);
    setGroups([]);
    setMode(null);
    setError(null);
  }, [pub?.current, pub?.round]);

  // Une carte posée ou défaussée quitte la sélection et les combinaisons en préparation.
  useEffect(() => {
    const own = new Set(handKey ? handKey.split(',') : []);
    setSelected((sel) => (sel.every((u) => own.has(u)) ? sel : sel.filter((u) => own.has(u))));
    setGroups((gs) => {
      if (gs.every((g) => g.every((u) => own.has(u)))) return gs;
      return gs.map((g) => g.filter((u) => own.has(u))).filter((g) => g.length > 0);
    });
  }, [handKey]);

  // Sons et vibration : déclenchés par les changements d'état, avant les retours anticipés.
  useChange(myTurn, (_, mine) => {
    if (mine) cueTurn();
  });
  useChange(me?.hand.length ?? 0, (before, after) => {
    if (before > 0 && after > before) playSound('draw');
  });
  useChange(pub?.melds.length ?? 0, (before, after) => {
    if (after > before) playSound('card');
  });
  useChange(pub?.discardTop?.uid ?? null, (before, after) => {
    if (before !== null && after) playSound('card');
  });
  useChange(pub?.roundWinner ?? null, (_, winner) => {
    if (winner && winner === playerId) playSound('win');
  });
  useChange(pub?.phase ?? '', (_, phase) => {
    if (phase === 'final') playSound('final');
  });

  if (!pub) return null;

  if (pub.phase === 'final') {
    const rank = ramiRanking(pub);
    const mine = rank.find((r) => r.playerId === playerId);
    return (
      <section className="player-game fade-in cards-player">
        <p className="big">Partie terminée</p>
        <p className="big-number">{mine?.points ?? 0} pts</p>
        <p className="muted">Le plus petit total gagne. Classement final sur l’écran principal.</p>
        <Ranking entries={rank} limit={5} />
      </section>
    );
  }

  if (!pub.started) {
    return (
      <section className="player-game fade-in">
        <p className="big">Préparez-vous !</p>
        <p className="muted">
          Ouverture à {pub.settings.openingPoints} points avec une tierce franche. Gardez vos cartes à l’abri des regards.
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

  const threshold = pub.settings.openingPoints;
  const hand = me.hand;
  const byUid = new Map(hand.map((c) => [c.uid, c]));
  const pick = (ids: readonly string[]) => ids.map((u) => byUid.get(u)).filter((c): c is RamiCard => !!c);
  const staged = new Set(groups.flat());
  const mustUse = new Set(me.mustUse);
  const visible = sortCards(
    hand.filter((c) => !staged.has(c.uid)),
    sort,
  );
  const selectedCards = pick(selected);
  const live = selectedCards.length >= 2 ? checkMeld(selectedCards) : null;
  const canAct = myTurn && me.hasDrawn && !busy;
  const mustCards = hand.filter((c) => mustUse.has(c.uid));

  const groupCards = groups.map((g) => pick(g));
  const opening = !me.opened && groups.length > 0 ? checkOpening(groupCards, threshold) : null;
  const laidCount = groups.flat().length;
  const keepOne = laidCount >= hand.length;

  async function run(type: string, payload?: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Action refusée.');
      return false;
    }
    return true;
  }

  function toggle(uid: string) {
    setError(null);
    setSelected((sel) => (sel.includes(uid) ? sel.filter((u) => u !== uid) : [...sel, uid]));
  }

  function addGroup() {
    if (!live) {
      setError('Choisissez au moins 3 cartes pour une combinaison.');
      return;
    }
    if (!live.ok) {
      setError(live.error);
      return;
    }
    setGroups((gs) => [...gs, selected]);
    setSelected([]);
  }

  async function open() {
    if (!opening) return;
    if (!opening.ok) {
      setError(opening.error);
      return;
    }
    if (keepOne) {
      setError('Gardez au moins une carte en main pour la défausse.');
      return;
    }
    if (await run('open', { melds: groups })) {
      setGroups([]);
      setSelected([]);
    }
  }

  async function laySelection() {
    if (live && !live.ok) {
      setError(live.error);
      return;
    }
    if (!live) {
      setError('Choisissez au moins 3 cartes pour une combinaison.');
      return;
    }
    if (await run('meld', { cardIds: selected })) setSelected([]);
  }

  function startMode(next: Exclude<Mode, null>) {
    setError(null);
    if (next === 'layoff' && selectedCards.length === 0) {
      setError('Choisissez d’abord les cartes à ajouter.');
      return;
    }
    if (next === 'swap' && selectedCards.length !== 1) {
      setError('Choisissez la carte exacte qui remplace le joker.');
      return;
    }
    setMode(mode === next ? null : next);
  }

  async function onMeld(meld: Meld) {
    const ok =
      mode === 'layoff'
        ? await run('layoff', { meldId: meld.id, cardIds: selected })
        : await run('swap', { meldId: meld.id, cardId: selected[0] });
    if (ok) {
      setSelected([]);
      setMode(null);
    }
  }

  async function discard() {
    if (selected.length !== 1) {
      setError('Choisissez la carte à défausser.');
      return;
    }
    if (await run('discard', { cardId: selected[0] })) setSelected([]);
  }

  let banner = `Tour de ${pub.current ? pub.names[pub.current] ?? '' : ''}`;
  if (pub.phase === 'round-over') banner = 'Manche terminée';
  else if (me.isMyTurn) {
    if (!me.hasDrawn) banner = 'À vous : piochez une carte';
    else if (mustCards.length > 0) banner = mustCards.some((c) => c.entry === 'jk') ? 'Reposez le joker récupéré' : 'Posez la carte prise';
    else banner = 'À vous : posez ou défaussez';
  }

  const top = pub.discardTop;
  const owner = (m: Meld) => (m.owner === playerId ? 'vous' : pub.names[m.owner] ?? '?');

  // Résultat de la manche
  if (pub.phase === 'round-over') {
    const res = pub.result;
    const mine = res?.penalties[playerId] ?? 0;
    return (
      <section className="player-game fade-in cards-player rami-player" data-mat="classique" onPointerDownCapture={() => unlockAudio()}>
        <div className="round-info">Manche {pub.round}</div>
        <p className="cards-banner">{banner}</p>
        <p className="muted">
          {res?.winner
            ? res.winner === playerId
              ? 'Vous avez défaussé votre dernière carte !'
              : `${pub.names[res.winner]} a défaussé sa dernière carte.`
            : 'Pioche épuisée : personne ne termine cette manche.'}
          {res?.ramiSec ? ' Rami sec : pénalités doublées.' : ''}
        </p>
        <p className="big-number">{mine === 0 ? '0 pénalité' : `+${mine} pts`}</p>
        <p className="muted small">La manche suivante démarre bientôt.</p>
        <Ranking entries={ramiRanking(pub)} />
      </section>
    );
  }

  const modeMelds = pub.melds.filter((m) => (mode === 'swap' ? m.cards.some((c) => c.entry === 'jk') : true));

  return (
    <section
      className="player-game fade-in cards-player rami-player"
      data-mat="classique"
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Manche {pub.round} · {pub.drawCount} en pioche
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${me.isMyTurn ? ' is-mine' : ''}`}>{banner}</p>

      <div className="rami-status">
        <span className="hud-pill">{me.opened ? 'Ouvert' : `Ouverture : ${threshold} points`}</span>
        <span className="hud-pill">{hand.length} cartes</span>
        <span className="hud-pill">{pub.scores[playerId] ?? 0} pts</span>
        {mustCards.length > 0 && <span className="hud-pill is-must">À poser : {labels(mustCards)}</span>}
      </div>

      <div className="table-mat hand-mat">
        <div className="cards-table-row rami-stock-row">
          <div className="rami-back" aria-label={`${pub.drawCount} cartes en pioche`}>
            <CardFace def={RAMI_DEFINITION} back />
          </div>
          <div className="cards-top">
            {top && (
              <div key={top.uid} className="top-card" data-uid={top.uid} data-zone="table">
                <CardFace def={RAMI_DEFINITION} entry={ramiEntry(top.entry)} label={cardName(top.entry)} />
              </div>
            )}
          </div>
          <div className="cards-table-info">
            <span className="hud-pill">Défausse : {pub.discardCount}</span>
            <button
              type="button"
              className="btn ghost small rami-sort"
              aria-pressed={sort === 'rank'}
              onClick={() => setSort(sort === 'suit' ? 'rank' : 'suit')}
            >
              Tri : {sort === 'suit' ? 'couleur' : 'valeur'}
            </button>
          </div>
        </div>

        {/* Au-delà de 9 cartes, deux éventails superposés : les cartes restent assez larges pour être touchées. */}
        <div className="rami-fans">
          {(visible.length > 9
            ? [visible.slice(0, Math.ceil(visible.length / 2)), visible.slice(Math.ceil(visible.length / 2))]
            : [visible]
          ).map((row, r, rows) => (
            <HandFan
              key={r}
              label={rows.length > 1 ? `Votre main, rangée ${r + 1} sur ${rows.length}` : 'Votre main'}
              mode="select"
              waiting={!me.isMyTurn}
              disabled={busy}
              onTap={toggle}
              items={row.map((card) => ({
                uid: card.uid,
                label: cardName(card.entry),
                selected: selected.includes(card.uid),
                playable: mustUse.has(card.uid),
                face: <CardFace def={RAMI_DEFINITION} entry={ramiEntry(card.entry)} label={cardName(card.entry)} />,
              }))}
            />
          ))}
        </div>
      </div>

      {/* Validité en direct de la sélection */}
      <div className="rami-live" aria-live="polite">
        {selectedCards.length === 0 ? (
          <span className="muted small">Touchez des cartes pour préparer une combinaison ou une défausse.</span>
        ) : live && live.ok ? (
          <span className="rami-ok">
            {meldTitle(live.kind, live.cards)} · {live.points} points{live.franche ? ' · tierce franche' : ''}
          </span>
        ) : live ? (
          <span className="rami-ko">{live.error}</span>
        ) : (
          <span className="muted small">{selectedCards.length} carte choisie : {labels(selectedCards)}</span>
        )}
      </div>

      {/* Avant l'ouverture : combinaisons en préparation */}
      {!me.opened && (
        <div className="rami-staging">
          {groups.length > 0 && (
            <ul className="rami-groups" aria-label="Combinaisons préparées">
              {groupCards.map((g, i) => {
                const check = checkMeld(g);
                return (
                  <li key={i} className={`rami-group ${check.ok ? 'is-ok' : 'is-ko'}`}>
                    <span className="rami-group-cards">{labels(g)}</span>
                    <span className="rami-group-pts">{check.ok ? `${check.points} pts${check.franche ? ' · franche' : ''}` : 'invalide'}</span>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setGroups((gs) => gs.filter((_, k) => k !== i))}
                      aria-label={`Retirer la combinaison ${i + 1}`}
                    >
                      Retirer
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {opening && !opening.ok && <p className="muted small">{opening.error}</p>}
          <div className="rami-actions">
            <button type="button" className="btn ghost big" disabled={busy || !live || !live.ok} onClick={addGroup}>
              Ajouter cette combinaison
            </button>
            <button type="button" className="btn primary big" disabled={!canAct || !opening || !opening.ok || keepOne} onClick={() => void open()}>
              Ouvrir ({opening?.points ?? 0} / {threshold})
            </button>
          </div>
        </div>
      )}

      {/* Après l'ouverture */}
      {me.opened && (
        <div className="rami-actions rami-actions-3">
          <button type="button" className="btn ghost big" disabled={!canAct || !live || !live.ok} onClick={() => void laySelection()}>
            Poser
          </button>
          <button type="button" className="btn ghost big" disabled={!canAct} aria-pressed={mode === 'layoff'} onClick={() => startMode('layoff')}>
            Compléter
          </button>
          <button type="button" className="btn ghost big" disabled={!canAct} aria-pressed={mode === 'swap'} onClick={() => startMode('swap')}>
            Échanger le joker
          </button>
        </div>
      )}

      {mode && (
        <div className="rami-pick" role="group" aria-label={mode === 'layoff' ? 'Choisir la combinaison à compléter' : 'Choisir le joker à échanger'}>
          <p className="rami-pick-title">{mode === 'layoff' ? `Ajouter ${labels(selectedCards)} à…` : `Échanger le joker contre ${labels(selectedCards)} dans…`}</p>
          {modeMelds.length === 0 && <p className="muted small">Aucune combinaison avec un joker sur la table.</p>}
          <ul>
            {modeMelds.map((m) => {
              const check = mode === 'layoff' ? checkLayoff(m, selectedCards) : selectedCards[0] ? checkSwap(m, selectedCards[0]) : null;
              const joker = m.cards.find((c) => c.entry === 'jk');
              return (
                <li key={m.id}>
                  <button type="button" className="rami-pick-btn" disabled={busy || !check || !check.ok} onClick={() => void onMeld(m)}>
                    <b>{meldTitle(m.kind, m.cards)}</b>
                    <span className="muted small">
                      {owner(m)} · {m.cards.map((c) => (c.entry === 'jk' ? '★' : cardLabel(c.entry))).join(' ')}
                      {joker && mode === 'swap' ? ` · joker = ${jokerText(joker)}` : ''}
                    </span>
                    {check && !check.ok && <span className="rami-ko small">{check.error}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {keepOne && !me.opened && groups.length > 0 && <p className="muted small">Gardez au moins une carte en main pour la défausse.</p>}

      <div className="control-dock cards-dock rami-dock">
        <button
          type="button"
          className="btn primary big"
          disabled={busy || !myTurn || me.hasDrawn}
          onClick={() => void run('draw', { from: 'deck' })}
        >
          Piocher
        </button>
        <button
          type="button"
          className="btn ghost big"
          disabled={busy || !me.canTakeDiscard}
          onClick={() => void run('draw', { from: 'discard' })}
        >
          Prendre la défausse
        </button>
        <button type="button" className="btn primary big" disabled={!canAct || selected.length !== 1} onClick={() => void discard()}>
          Défausser
        </button>
        <button type="button" className="btn ghost big" disabled={busy || !me.canUndo} onClick={() => void run('undo')}>
          Annuler mon tour
        </button>
      </div>
    </section>
  );
}
