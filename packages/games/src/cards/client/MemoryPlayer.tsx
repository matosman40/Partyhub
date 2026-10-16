import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { Ranking } from '../../client/ui.js';
import { play, unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { cueTurn, useChange } from './cues.js';
import { entryOf, rankingOf } from './common.js';
import { isHidden, memoryColumns, type MemoryPlayerState, type MemoryPublic } from './memory-common.js';

/** Téléphone du mémo : on touche deux cartes à son tour pour former une paire. */
export function MemoryPlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as MemoryPublic | null;
  const me = playerState as MemoryPlayerState | null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const myTurn = !!me?.isMyTurn && pub?.phase === 'play';

  useChange(myTurn, (_, mine) => {
    if (mine) cueTurn();
  });
  useChange(pub?.matches ?? 0, (before, after) => {
    if (after > before) play('pickup');
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

  const currentName = pub.current ? pub.names[pub.current] : '';
  const canFlip = me.canFlip && !busy;
  const cols = memoryColumns(pub.board.length, 0.5);

  async function flip(uid: string) {
    if (!canFlip) return;
    setBusy(true);
    setError(null);
    const res = await send('flip', { cardId: uid });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Coup refusé.');
  }

  let banner = `Tour de ${currentName}`;
  if (pub.phase === 'peek') banner = 'Les cartes se retournent…';
  else if (myTurn) banner = 'À vous : retournez une carte';

  return (
    <section
      className="player-game fade-in cards-player memory-player"
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="round-info">
        Paires {pub.matches} / {pub.pairs} · {pub.scores[playerId] ?? 0} pts
      </div>
      <div className="sound-row">
        <SoundToggle />
      </div>
      <p className={`cards-banner${myTurn ? ' is-mine' : ''}`}>{banner}</p>

      <div className="memory-board" style={{ ['--memory-cols' as string]: cols }}>
        {pub.board.map((cell, index) => {
          const entry = cell.entry ? entryOf(pub.def, cell.entry) : undefined;
          const hidden = isHidden(cell);
          const tappable = canFlip && hidden;
          const label = entry
            ? `${entry.label || entry.text?.slice(0, 40) || 'Carte'}${cell.owner ? ', paire trouvée' : ''}`
            : `Carte ${index + 1}, face cachée`;
          return (
            <button
              key={cell.uid}
              type="button"
              className={`memory-tile${cell.owner ? ' is-found' : ''}${!hidden && !cell.owner ? ' is-open' : ''}`}
              disabled={!tappable}
              aria-label={label}
              onClick={() => void flip(cell.uid)}
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
      {!myTurn && pub.phase === 'play' && <p className="muted">Attendez votre tour.</p>}
    </section>
  );
}
