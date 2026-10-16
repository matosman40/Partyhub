import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';
import type { Resolution } from '../module.js';
import { ResolutionCard, SheetCard, type SheetView } from './parts.js';

interface ChoiceView {
  id: string;
  label: string;
  statLabel: string;
  difficulty: number;
}

/** Vue publique de l'aventure (voir `getPublicState` dans le module). */
interface AventurePublic {
  phase: 'lobby' | 'preparing' | 'choose' | 'vote' | 'final';
  preparing: 'roster' | 'scene' | 'epilogue' | null;
  reveal: boolean;
  characters: SheetView[];
  sceneNumber: number;
  total: number;
  scene: { title: string; text: string; choices: ChoiceView[] } | null;
  resolution: Resolution | null;
  epilogue: { title: string; text: string } | null;
  victory: boolean | null;
  endsAt: number;
  durationMs: number;
  ranking: { playerId: string; points: number; rank: number }[];
}

/** Vue privée d'un joueur (voir `getPlayerState` dans le module). */
interface AventurePlayerState {
  characterId: string | null;
  ko: boolean;
  canPick: boolean;
  canVote: boolean;
  hasVoted: boolean;
  myVote: string | null;
}

const PREPARING_TEXT: Record<NonNullable<AventurePublic['preparing']>, string> = {
  roster: 'Le conteur dessine le monde…',
  scene: 'Le conteur écrit la suite…',
  epilogue: 'Le conteur écrit le dénouement…',
};

/** Pendant la révélation, le jet reste à l'écran : la suite arrive ensuite. */
function preparingText(pub: AventurePublic): string {
  if (pub.reveal) return 'Le jet est joué. La suite arrive…';
  return pub.preparing ? PREPARING_TEXT[pub.preparing] : 'Le conteur réfléchit…';
}

export function AventurePlayer({ publicState, playerState, playerId, now, send }: PlayerViewProps) {
  const pub = publicState as AventurePublic | null;
  const me = playerState as AventurePlayerState | null;
  const remaining = useRemaining(pub?.endsAt, now);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return <WaitingScreen title="En attente de l’aventure…" />;

  const mine = pub.characters.find((c) => c.ownerId === playerId) ?? null;

  async function act(type: string, payload: unknown) {
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée.');
  }

  if (pub.phase === 'final') {
    const mark = pub.ranking.find((e) => e.playerId === playerId);
    return (
      <section className="player-game fade-in aventure">
        {pub.epilogue && (
          <article className="aventure-epilogue">
            <p className="label">{pub.victory ? 'Victoire' : 'Défaite'}</p>
            <h2>{pub.epilogue.title}</h2>
            <p className="aventure-epilogue-text">{pub.epilogue.text}</p>
          </article>
        )}
        <FinalScreen points={mark?.points ?? 0} rank={mark?.rank ?? null} />
      </section>
    );
  }

  if (pub.phase === 'choose') {
    const canPick = me?.canPick ?? false;
    return (
      <section className="player-game fade-in aventure">
        <p className="label">Choisissez votre personnage</p>
        <Countdown remaining={remaining} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="aventure-pick-list">
          {pub.characters.map((c) => {
            const taken = c.ownerId !== null && c.ownerId !== playerId;
            const selected = c.ownerId === playerId;
            return (
              <button
                key={c.id}
                type="button"
                className={`aventure-pick${selected ? ' is-selected' : ''}`}
                disabled={!canPick || busy || taken}
                aria-pressed={selected}
                onClick={() => void act('pick', { characterId: c.id })}
              >
                <span aria-hidden="true">{c.emoji}</span>
                <span className="aventure-pick-name">{c.name}</span>
                <span className="muted">{taken ? `Joué par ${c.ownerName}` : c.title}</span>
              </button>
            );
          })}
        </div>
        {mine && <SheetCard c={mine} detailed highlight />}
      </section>
    );
  }

  if (pub.phase === 'vote') {
    if (!mine || !pub.scene) {
      return <WaitingScreen title="Vous suivez l’aventure en spectateur." />;
    }
    const down = me?.ko ?? mine.pv === 0;
    return (
      <section className="player-game fade-in aventure">
        <p className="label">
          Scène {pub.sceneNumber} sur {pub.total}
        </p>
        <h2 className="aventure-scene-title">{pub.scene.title}</h2>
        <p className="aventure-scene-text">{pub.scene.text}</p>
        <Countdown remaining={remaining} />
        {down ? (
          <p className="big">Votre personnage est à terre. Vous suivez la suite en spectateur.</p>
        ) : (
          <>
            <p className="muted">
              {me?.hasVoted
                ? 'Vote enregistré. Vous pouvez encore changer de choix.'
                : 'Votez pour le choix qui vous tente.'}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="aventure-vote-list">
              {pub.scene.choices.map((c) => {
                const chosen = me?.myVote === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`aventure-vote${chosen ? ' is-chosen' : ''}`}
                    disabled={busy}
                    aria-pressed={chosen}
                    onClick={() => void act('vote', { choiceId: c.id })}
                  >
                    <span className="aventure-vote-label">{c.label}</span>
                    <span className="aventure-choice-tag">{c.statLabel}</span>
                    <span className="aventure-choice-tag">Difficulté {c.difficulty}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <details className="aventure-sheet-toggle">
          <summary>Ma fiche</summary>
          <SheetCard c={mine} detailed highlight />
        </details>
      </section>
    );
  }

  // Préparation : l'histoire s'écrit, le dernier jet reste affiché.
  return (
    <section className="player-game fade-in aventure">
      <p className="big">{preparingText(pub)}</p>
      {pub.resolution && <ResolutionCard r={pub.resolution} />}
      {mine && <SheetCard c={mine} highlight />}
    </section>
  );
}
