import { useEffect, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { Ranking } from '../../client/ui.js';
import { play as playSound, unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from '../../cards/client/CardFace.js';
import { HandFan } from '../../cards/client/HandFan.js';
import { cueTurn, useChange } from '../../cards/client/cues.js';
import { entryOf, rankingOf, type CardsPublic } from '../../cards/client/common.js';
import { sortHandByRank, validatePlay } from '../rules.js';

/** Vue publique du Président : le pli, les rangs et les passes en plus des champs communs. */
interface PresidentPub extends CardsPublic {
  rounds: number;
  pile: { uid: string; entry: string }[];
  pileRank: number;
  pileCount: number;
  passed: string[];
  finished: string[];
  roles: Record<string, string>;
}

interface PresidentPlayerState {
  hand: { uid: string; entry: string }[];
  isMyTurn: boolean;
  canPass: boolean;
  spectator: boolean;
  finished: boolean;
}

/** Téléphone du Président : on touche les cartes à poser (même rang), puis on joue. */
export function PresidentPlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as PresidentPub | null;
  const me = playerState as PresidentPlayerState | null;
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La sélection repart à zéro dès que le jeu avance (nouveau pli, nouveau tour).
  useEffect(() => {
    setSelected([]);
    setError(null);
  }, [pub?.pileCount, pub?.round, pub?.current]);

  // Sons et vibration : déclenchés par les changements d’état, avant les retours anticipés.
  const myTurn = !!me?.isMyTurn && pub?.phase === 'play';
  useChange(myTurn, (_, mine) => {
    if (mine) cueTurn();
  });
  useChange(me?.hand.length ?? 0, (before, after) => {
    if (before > 0 && after > before) playSound('draw');
  });
  useChange(pub?.pileCount ?? 0, (before, after) => {
    if (after > before) playSound('card');
  });
  useChange(pub?.roundWinner ?? null, (_, winner) => {
    if (winner && winner === playerId) playSound('win');
  });

  if (!pub) return null;

  if (pub.phase === 'final') {
    const rank = rankingOf(pub);
    const mine = rank.find((r) => r.playerId === playerId);
    return (
      <section className="player-game fade-in cards-player">
        <p className="big">Partie terminée</p>
        <p className="big-number">{mine?.points ?? 0} pts</p>
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

  const selectedCards = selected.map((uid) => entryOf(pub.def, uid)).filter((c): c is NonNullable<typeof c> => !!c);
  const check = selectedCards.length > 0 ? validatePlay(pub.pileRank, pub.pileCount, selectedCards) : null;
  const canPlay = me.isMyTurn && pub.phase === 'play' && check?.ok === true;

  function toggle(uid: string) {
    if (!me?.isMyTurn) {
      setError('Ce n’est pas votre tour.');
      return;
    }
    const entry = entryOf(pub!.def, uid);
    const selectedEntry = selectedCards[0];
    setError(null);
    if (selected.includes(uid)) {
      setSelected(selected.filter((id) => id !== uid));
      return;
    }
    // Un seul rang à la fois : toucher une autre valeur remplace la sélection.
    if (selectedEntry && entry && selectedEntry.label !== entry.label) {
      setSelected([uid]);
      return;
    }
    if (selected.length >= 4) return;
    setSelected([...selected, uid]);
  }

  async function play() {
    if (!canPlay || busy) return;
    setBusy(true);
    const res = await send('play', { cardIds: selected });
    setBusy(false);
    if (res.ok) setSelected([]);
    else setError(res.error ?? 'Coup refusé.');
  }

  async function pass() {
    if (!me?.canPass || busy) return;
    setBusy(true);
    const res = await send('pass');
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Passe refusée.');
  }

  const topLabel = pub.pile[0] ? (entryOf(pub.def, pub.pile[0].entry)?.label ?? '') : '';
  const banner =
    pub.phase === 'round-over'
      ? 'Manche terminée'
      : me.isMyTurn
        ? pub.pileCount > 0
          ? `Battez le pli de ${pub.pileCount} × ${topLabel}`
          : 'À vous : posez une carte'
        : `Tour de ${pub.current ? pub.names[pub.current] : ''}`;

  return (
    <section
      className="player-game fade-in cards-player pres-player"
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Manche {pub.round} / {pub.rounds}
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${me.isMyTurn ? ' is-mine' : ''}`}>{banner}</p>

      {pub.phase === 'round-over' ? (
        <>
          <p className="muted">Les cartes sont redistribuées avant la manche suivante.</p>
          <Ranking entries={rankingOf(pub)} />
        </>
      ) : (
        <>
          <div className="pres-status">
            {me.finished && <span className="hud-pill">Vous êtes sorti(e)</span>}
            <span className="hud-pill">{pub.counts[playerId] ?? 0} cartes</span>
            {pub.pileCount > 0 && (
              <span className="hud-pill">
                Pli : {pub.pileCount} × {topLabel}
              </span>
            )}
          </div>

          <div className="table-mat hand-mat">
            <HandFan
              label="Votre main"
              mode="select"
              waiting={!me.isMyTurn}
              disabled={busy || !me.isMyTurn}
              onTap={toggle}
              items={sortHandByRank(me.hand).map((card) => {
                const entry = entryOf(pub.def, card.entry);
                return {
                  uid: card.uid,
                  label: entry?.symbol ?? 'Carte',
                  selected: selected.includes(card.uid),
                  face: <CardFace def={pub.def} entry={entry} />,
                };
              })}
            />
          </div>

          {check && !check.ok && <p className="muted small">{check.error}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}

      {pub.phase === 'play' && (
        <div className="control-dock cards-dock">
          <button type="button" className="btn ghost big" disabled={busy || !me.canPass} onClick={() => void pass()}>
            Passer
          </button>
          <button type="button" className="btn primary big" disabled={busy || !canPlay} onClick={() => void play()}>
            Jouer{selected.length > 1 ? ` (${selected.length})` : ''}
          </button>
        </div>
      )}
    </section>
  );
}
