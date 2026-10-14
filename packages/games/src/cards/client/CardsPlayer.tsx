import { useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { Ranking } from '../../client/ui.js';
import { play, unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { HandFan } from './HandFan.js';
import { cueTurn, useCardFlights, useChange } from './cues.js';
import { entryOf, familyOf, rankingOf, type CardsPlayerState, type CardsPublic } from './common.js';

/** Téléphone d'un jeu de cartes : la main, le tour en cours et les actions. */
export function CardsPlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as CardsPublic | null;
  const me = playerState as CardsPlayerState | null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  // Sons, vibration et trajets : déclenchés par les changements d'état (les hooks restent avant les retours anticipés).
  const myTurn = !!me?.isMyTurn && pub?.phase === 'play';
  useChange(myTurn, (_, mine) => {
    if (mine) cueTurn();
  });
  useChange(me?.hand.length ?? 0, (before, after) => {
    if (before > 0 && after > before) play('draw');
  });
  useChange(pub?.top?.uid ?? null, (before, after) => {
    if (before !== null && after) play('card');
  });
  useChange(pub?.roundWinner ?? null, (_, winner) => {
    if (winner && winner === playerId) play('win');
  });
  useCardFlights(rootRef);

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

  const top = pub.top ? entryOf(pub.def, pub.top.entry) : undefined;
  const family = familyOf(pub.def, pub.family);
  const playable = new Set(me.playable);
  const currentName = pub.current ? pub.names[pub.current] : '';

  async function run(type: string, payload?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée.');
  }

  function tapCard(uid: string) {
    if (!playable.has(uid)) {
      setError('Cette carte ne va pas sur la défausse.');
      return;
    }
    // La carte se soulève tout de suite ; elle partira sur la table dès que le serveur la confirme.
    setPendingUid(uid);
    void run('play', { cardId: uid }).finally(() => setPendingUid(null));
  }

  let banner = `Tour de ${currentName}`;
  if (pub.phase === 'round-over') banner = 'Manche terminée';
  else if (me.mustPick) banner = 'Choisissez la couleur à suivre';
  else if (me.isMyTurn) banner = me.canPass ? 'Jouez une carte ou passez' : 'À vous de jouer';

  return (
    <section
      ref={rootRef}
      className="player-game fade-in cards-player"
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Manche {pub.round} · {pub.drawCount} en pioche
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${me.isMyTurn || me.mustPick ? ' is-mine' : ''}`}>{banner}</p>

      {pub.phase === 'round-over' ? (
        <>
          <p className="muted">
            {pub.roundWinner ? `${pub.names[pub.roundWinner]} a vidé sa main.` : 'Manche terminée.'} La suite démarre bientôt.
          </p>
          <Ranking entries={rankingOf(pub)} />
        </>
      ) : (
        <>
          <div className="table-mat hand-mat">
            <div className="cards-table-row">
              <div className="cards-top">
                {top && pub.top && (
                  <div key={pub.top.uid} className="top-card" data-uid={pub.top.uid} data-zone="table">
                    <CardFace def={pub.def} entry={top} />
                  </div>
                )}
              </div>
              <div className="cards-table-info">
                {family && (
                  <span className="hud-pill family-chip">
                    <i style={{ background: family.color }} />
                    {family.label}
                  </span>
                )}
                <span className="hud-pill">{pub.direction === 1 ? '↻' : '↺'} sens</span>
              </div>
            </div>

            {me.mustPick ? (
              <div className="family-picks" role="group" aria-label="Choisir la couleur">
                {pub.def.families.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="family-pick"
                    style={{ ['--fam' as string]: f.color }}
                    disabled={busy}
                    onClick={() => void run('choose-family', { family: f.id })}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ) : (
              <HandFan
                label="Votre main"
                mode="play"
                waiting={!me.isMyTurn}
                disabled={busy || !me.isMyTurn}
                onTap={tapCard}
                pendingUid={pendingUid}
                items={me.hand.map((card) => {
                  const entry = entryOf(pub.def, card.entry);
                  return {
                    uid: card.uid,
                    label: entry?.label || 'Carte',
                    playable: playable.has(card.uid),
                    face: <CardFace def={pub.def} entry={entry} />,
                  };
                })}
              />
            )}
          </div>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {me.hand.length === 0 && pub.phase === 'play' && <p className="muted">Votre main est vide.</p>}

      {pub.phase === 'play' && !me.mustPick && (
        <div className="control-dock cards-dock">
          <button type="button" className="btn primary big" disabled={busy || !me.canDraw} onClick={() => void run('draw')}>
            Piocher
          </button>
          <button type="button" className="btn ghost big" disabled={busy || !me.canPass} onClick={() => void run('pass')}>
            Passer
          </button>
        </div>
      )}
    </section>
  );
}
