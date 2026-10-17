import { useEffect, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';
import type { Resolution, RoundReport } from '../module.js';
import { COMBAT_ACTIONS, COMBAT_ACTION_INFO, STAT_LABELS, type SceneKind } from '../schemas.js';
import {
  ArtBadge,
  FoeCard,
  KindTag,
  NpcCard,
  ResolutionCard,
  RoundReportCard,
  SheetCard,
  type FoeView,
  type NpcView,
  type SheetView,
} from './parts.js';

interface ChoiceView {
  id: string;
  label: string;
  statLabel: string;
  difficulty: number;
}

interface CombatView {
  foe: FoeView;
  sceneTitle: string;
  round: number;
  step: 'act' | 'reveal';
  actedCount: number;
  actorCount: number;
  report: RoundReport | null;
  over: boolean;
  progress: string[];
}

/** Vue publique de l’aventure (voir `getPublicState` dans le module). */
interface AventurePublic {
  phase: 'lobby' | 'preparing' | 'choose' | 'vote' | 'combat' | 'final';
  preparing: 'roster' | 'scene' | 'epilogue' | null;
  reveal: boolean;
  theme: string;
  difficulty: string;
  world: { title: string; intro: string; goal: string } | null;
  characters: SheetView[];
  sceneNumber: number;
  total: number;
  scene: {
    kind: SceneKind;
    title: string;
    text: string;
    hint: string | null;
    npc: NpcView | null;
    choices: ChoiceView[];
  } | null;
  combat: CombatView | null;
  resolution: Resolution | null;
  epilogue: { title: string; text: string } | null;
  victory: boolean | null;
  endsAt: number;
  durationMs: number;
  ranking: { playerId: string; points: number; rank: number }[];
}

/** Un personnage gardé dans le profil du joueur, qu’il peut reprendre au début de l’aventure. */
interface LibraryView {
  libraryId: string;
  name: string;
  title: string;
  emoji: string;
  level: number;
  games: number;
  victories: number;
  /** Portrait généré gardé avec le personnage, ou null. */
  portraitId: string | null;
  inPlay: boolean;
}

/** Vue privée d’un joueur (voir `getPlayerState` dans le module). */
interface AventurePlayerState {
  characterId: string | null;
  ko: boolean;
  canPick: boolean;
  canVote: boolean;
  hasVoted: boolean;
  myVote: string | null;
  canAct: boolean;
  acted: boolean;
  myAction: keyof typeof COMBAT_ACTION_INFO | null;
  library: LibraryView[];
}

const PREPARING_TEXT: Record<NonNullable<AventurePublic['preparing']>, string> = {
  roster: 'Le conteur dessine le monde…',
  scene: 'Le conteur écrit la suite…',
  epilogue: 'Le conteur écrit le dénouement…',
};

/** Choix d’un joueur, envoyé au salon et affiché avant sa confirmation. */
interface Sent {
  kind: 'pick' | 'library' | 'vote' | 'combat';
  id: string;
}

/** Erreur d’un choix, avec l’étape où il a été fait : une étape suivante n’affiche pas l’erreur de la précédente. */
interface ActError {
  text: string;
  step: string;
}

/** Pendant la révélation, le résultat reste affiché : la suite arrive ensuite. */
function preparingText(pub: AventurePublic): string {
  if (pub.reveal) return 'Le résultat est joué. La suite arrive…';
  return pub.preparing ? PREPARING_TEXT[pub.preparing] : 'Le conteur réfléchit…';
}

export function AventurePlayer({ publicState, playerState, playerId, now, send, connected }: PlayerViewProps) {
  const pub = publicState as AventurePublic | null;
  const me = playerState as AventurePlayerState | null;
  const remaining = useRemaining(pub?.endsAt, now);
  const [error, setError] = useState<ActError | null>(null);
  const [busy, setBusy] = useState(false);
  // Choix envoyé, affiché tout de suite : le salon le confirme ensuite (il arrive avec l’état de la partie), ou le
  // retire avec une erreur. Sans cela, chaque appui ne se voyait qu’après l’aller-retour, soit 160 ms sur 4G.
  const [sent, setSent] = useState<Sent | null>(null);
  // Un nouveau choix, une nouvelle scène ou une nouvelle manche remettent à zéro le choix envoyé.
  useEffect(() => {
    setSent(null);
  }, [pub?.phase, pub?.sceneNumber, me?.characterId, me?.myVote, me?.myAction]);
  // Au rétablissement de la connexion, le message « connexion perdue » n’a plus lieu d’être.
  useEffect(() => {
    if (connected) setError(null);
  }, [connected]);

  if (!pub) return <WaitingScreen title="En attente de l’aventure…" />;

  const mine = pub.characters.find((c) => c.ownerId === playerId) ?? null;
  // Un refus n’est montré que dans l’étape où le choix a été fait : arrivé trop tard, il ne reste pas à l’écran.
  const step = `${pub.phase}:${pub.sceneNumber}`;
  const shownError = error?.step === step ? error.text : null;

  async function act(type: string, payload: unknown, shown: Sent) {
    setBusy(true);
    setError(null);
    setSent(shown);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) {
      setSent(null);
      setError({ text: res.error ?? 'Action refusée.', step });
    }
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
    const library = me?.library ?? [];
    return (
      <section className="player-game fade-in aventure">
        <p className="label">Choisissez votre personnage</p>
        <p className="aventure-meta muted">
          {pub.theme} · difficulté {pub.difficulty}
        </p>
        {pub.world && <p className="aventure-goal">{pub.world.goal}</p>}
        <Countdown remaining={remaining} />
        {shownError && (
          <p className="error" role="alert">
            {shownError}
          </p>
        )}
        {library.length > 0 && (
          <>
            <p className="label">Tes personnages</p>
            <div className="aventure-library">
              {library.map((l) => {
                const inPlay = l.inPlay || (sent?.kind === 'library' && sent.id === l.libraryId);
                return (
                  <button
                    key={l.libraryId}
                    type="button"
                    className={`aventure-pick${inPlay ? ' is-selected' : ''}`}
                    disabled={!canPick || busy}
                    aria-pressed={inPlay}
                    onClick={() => void act('pick', { characterId: l.libraryId }, { kind: 'library', id: l.libraryId })}
                  >
                    <ArtBadge id={l.portraitId} emoji={l.emoji} />
                    <span className="aventure-pick-name">{l.name}</span>
                    <span className="muted">
                      Niveau {l.level} · {l.games} partie(s)
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <p className="label">Ou un personnage de l’aventure</p>
        <div className="aventure-pick-list">
          {pub.characters.map((c) => {
            const taken = c.ownerId !== null && c.ownerId !== playerId;
            const selected = c.ownerId === playerId || (sent?.kind === 'pick' && sent.id === c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`aventure-pick${selected ? ' is-selected' : ''}`}
                disabled={!canPick || busy || taken}
                aria-pressed={selected}
                onClick={() => void act('pick', { characterId: c.id }, { kind: 'pick', id: c.id })}
              >
                <ArtBadge id={c.portraitId} emoji={c.emoji} />
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
    const voteHint =
      pub.scene.kind === 'dialogue' ? 'Votez la réplique du groupe.' : 'Votez pour le choix qui vous tente.';
    return (
      <section className="player-game fade-in aventure">
        <p className="label">
          Scène {pub.sceneNumber} sur {pub.total}
        </p>
        <div className="aventure-meta">
          <KindTag kind={pub.scene.kind} />
        </div>
        <h2 className="aventure-scene-title">{pub.scene.title}</h2>
        <p className="aventure-scene-text">{pub.scene.text}</p>
        {pub.scene.hint && <p className="aventure-hint">Indice : {pub.scene.hint}</p>}
        {pub.scene.npc && <NpcCard npc={pub.scene.npc} />}
        <Countdown remaining={remaining} />
        {down ? (
          <p className="big">Votre personnage est à terre. Vous suivez la suite en spectateur.</p>
        ) : (
          <>
            <p className="muted">{me?.hasVoted ? 'Vote enregistré. Vous pouvez encore changer de choix.' : voteHint}</p>
            {shownError && (
              <p className="error" role="alert">
                {shownError}
              </p>
            )}
            <div className="aventure-vote-list">
              {pub.scene.choices.map((c) => {
                const chosen = (sent?.kind === 'vote' ? sent.id : me?.myVote) === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`aventure-vote${chosen ? ' is-chosen' : ''}`}
                    disabled={busy}
                    aria-pressed={chosen}
                    onClick={() => void act('vote', { choiceId: c.id }, { kind: 'vote', id: c.id })}
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

  if (pub.phase === 'combat' && pub.combat) {
    const combat = pub.combat;
    const down = me?.ko ?? mine?.pv === 0;

    if (combat.step === 'reveal') {
      return (
        <section className="player-game fade-in aventure">
          <p className="label">
            {combat.sceneTitle} · manche {combat.round}
          </p>
          <FoeCard foe={combat.foe} />
          {combat.report && (
            <RoundReportCard report={combat.report} highlightId={mine?.id ?? null} progress={combat.progress} />
          )}
          <Countdown remaining={remaining} />
          {mine && <SheetCard c={mine} highlight />}
        </section>
      );
    }

    if (!mine || down) {
      return (
        <section className="player-game fade-in aventure">
          <FoeCard foe={combat.foe} />
          <WaitingScreen title="Votre personnage est à terre : vous suivez le combat en spectateur." />
        </section>
      );
    }
    return (
      <section className="player-game fade-in aventure">
        <p className="label">
          {combat.sceneTitle} · manche {combat.round}
        </p>
        <FoeCard foe={combat.foe} />
        <Countdown remaining={remaining} />
        <p className="muted">
          {me?.acted
            ? `Action choisie : ${me.myAction ? COMBAT_ACTION_INFO[me.myAction].label : ''}. En attente des autres (${combat.actedCount} / ${combat.actorCount}).`
            : `Choisissez votre action (${combat.actedCount} / ${combat.actorCount} prêts).`}
        </p>
        {shownError && (
          <p className="error" role="alert">
            {shownError}
          </p>
        )}
        <div className="aventure-actions">
          {COMBAT_ACTIONS.map((id) => {
            const info = COMBAT_ACTION_INFO[id];
            const chosen = (sent?.kind === 'combat' ? sent.id : me?.myAction) === id;
            return (
              <button
                key={id}
                type="button"
                className={`aventure-action${chosen ? ' is-chosen' : ''}`}
                disabled={busy || !me?.canAct}
                aria-pressed={chosen}
                onClick={() => void act('combat', { action: id }, { kind: 'combat', id })}
              >
                <span className="aventure-action-label">{info.label}</span>
                <span className="aventure-choice-tag">{STAT_LABELS[info.stat]}</span>
                <span className="aventure-action-effect">{info.effect}</span>
              </button>
            );
          })}
        </div>
        <details className="aventure-sheet-toggle" open>
          <summary>Ma fiche</summary>
          <SheetCard c={mine} highlight />
        </details>
      </section>
    );
  }

  // Préparation : l’histoire s’écrit, le dernier résultat reste affiché.
  return (
    <section className="player-game fade-in aventure">
      <p className="big">{preparingText(pub)}</p>
      {pub.resolution && <ResolutionCard r={pub.resolution} />}
      {pub.combat?.over && pub.combat.report && (
        <RoundReportCard report={pub.combat.report} highlightId={mine?.id ?? null} progress={pub.combat.progress} />
      )}
      {mine && <SheetCard c={mine} highlight />}
    </section>
  );
}
