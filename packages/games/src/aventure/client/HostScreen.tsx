import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import type { Resolution } from '../module.js';
import { ResolutionCard, SheetCard, type SheetView } from './parts.js';

interface SceneView {
  title: string;
  text: string;
  choices: { id: string; label: string; statLabel: string; difficulty: number }[];
}

/** Vue publique de l'aventure (voir `getPublicState` dans le module). */
interface AventurePublic {
  phase: 'lobby' | 'preparing' | 'choose' | 'vote' | 'final';
  preparing: 'roster' | 'scene' | 'epilogue' | null;
  reveal: boolean;
  mode: 'ia' | 'secours' | null;
  tone: string;
  world: { title: string; intro: string } | null;
  characters: SheetView[];
  playerCount: number;
  pickedCount: number;
  sceneNumber: number;
  total: number;
  scene: SceneView | null;
  voteCount: number;
  voterCount: number;
  resolution: Resolution | null;
  epilogue: { title: string; text: string } | null;
  victory: boolean | null;
  endsAt: number;
  durationMs: number;
  ranking: Parameters<typeof FinalHost>[0]['ranking'];
}

/** Vue réservée à l'écran principal : qui doit encore agir. */
interface AventureHostOnly {
  canRegenerate: boolean;
  pending: string[];
}

const PREPARING_TEXT: Record<NonNullable<AventurePublic['preparing']>, string> = {
  roster: 'Le conteur dessine le monde et ses personnages…',
  scene: 'Le conteur écrit la suite de l’histoire…',
  epilogue: 'Le conteur écrit le dénouement…',
};

function ModeNote({ mode }: { mode: AventurePublic['mode'] }) {
  if (!mode) return null;
  return (
    <p className="aventure-mode muted">
      {mode === 'ia' ? 'Histoire écrite en direct par une IA.' : 'Histoire de secours : l’IA n’est pas disponible.'}
    </p>
  );
}

function PendingNote({ names, label }: { names: string[]; label: string }) {
  if (names.length === 0) return null;
  return (
    <p className="muted">
      {label} {names.join(', ')}
    </p>
  );
}

function Finale({ pub }: { pub: AventurePublic }) {
  return (
    <section className="game-host fade-in final aventure">
      {pub.epilogue ? (
        <article className="aventure-epilogue">
          <p className="label">{pub.victory ? 'Victoire' : 'Défaite'}</p>
          <h2 className="big-title">{pub.epilogue.title}</h2>
          <p className="aventure-epilogue-text">{pub.epilogue.text}</p>
        </article>
      ) : (
        <p className="muted">L’aventure s’arrête là.</p>
      )}
      <FinalHost ranking={pub.ranking} />
    </section>
  );
}

function Choose({
  pub,
  host,
  now,
  onAction,
}: {
  pub: AventurePublic;
  host: AventureHostOnly | null;
  now: number;
  onAction?: HostViewProps['onAction'];
}) {
  const remaining = useRemaining(pub.endsAt, now);
  return (
    <>
      {pub.world && (
        <header className="aventure-world">
          <h2 className="aventure-world-title">{pub.world.title}</h2>
          <p className="aventure-world-intro">{pub.world.intro}</p>
          <ModeNote mode={pub.mode} />
          <p className="muted">Ton : {pub.tone}</p>
        </header>
      )}
      <p className="muted">
        Choisissez votre personnage sur vos téléphones : {pub.pickedCount} / {pub.playerCount} choisi(s).
      </p>
      <PendingNote names={host?.pending ?? []} label="En attente de :" />
      <div className="aventure-cards">
        {pub.characters.map((c) => (
          <SheetCard key={c.id} c={c} />
        ))}
      </div>
      <TimerBar remaining={remaining} total={pub.durationMs} />
      {host?.canRegenerate && onAction && (
        <button type="button" className="btn ghost" onClick={() => void onAction('regenerate')}>
          Générer d’autres personnages
        </button>
      )}
    </>
  );
}

function Vote({ pub, host, remaining }: { pub: AventurePublic; host: AventureHostOnly | null; remaining: number }) {
  const scene = pub.scene;
  if (!scene) return null;
  return (
    <>
      <section className="aventure-scene" aria-label="Scène en cours">
        <p className="label">
          Scène {pub.sceneNumber} sur {pub.total}
        </p>
        <h2 className="aventure-scene-title">{scene.title}</h2>
        <p className="aventure-scene-text">{scene.text}</p>
        <ol className="aventure-choices">
          {scene.choices.map((c, i) => (
            <li key={c.id}>
              <span className="aventure-choice-index" aria-hidden="true">
                {i + 1}
              </span>
              <span className="aventure-choice-label">{c.label}</span>
              <span className="aventure-choice-tag">{c.statLabel}</span>
              <span className="aventure-choice-tag">Difficulté {c.difficulty}</span>
            </li>
          ))}
        </ol>
        <p className="muted">
          {pub.voteCount} / {pub.voterCount} vote(s)
        </p>
        <PendingNote names={host?.pending ?? []} label="Vote attendu de :" />
      </section>
      <TimerBar remaining={remaining} total={pub.durationMs} />
    </>
  );
}

/** Pendant la révélation, le jet reste à l'écran : la suite arrive ensuite. */
function preparingText(pub: AventurePublic): string {
  if (pub.reveal) return 'Le jet est joué. La suite arrive…';
  return pub.preparing ? PREPARING_TEXT[pub.preparing] : 'Le conteur réfléchit…';
}

function Preparing({ pub }: { pub: AventurePublic }) {
  const text = preparingText(pub);
  return (
    <section className="aventure-preparing" aria-live="polite">
      <p className="aventure-preparing-text">{text}</p>
      {pub.resolution && <ResolutionCard r={pub.resolution} />}
    </section>
  );
}

function CharacterRow({ characters }: { characters: SheetView[] }) {
  return (
    <div className="aventure-cards compact">
      {characters.map((c) => (
        <SheetCard key={c.id} c={c} />
      ))}
    </div>
  );
}

export function AventureHost({ publicState, hostState, now, onAction }: HostViewProps) {
  const pub = publicState as AventurePublic | null;
  const host = hostState as AventureHostOnly | null;
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <Finale pub={pub} />;
  if (pub.phase === 'lobby') return <WaitingScreen title="En attente du lancement…" />;

  return (
    <section className="game-host fade-in aventure">
      {pub.phase === 'choose' && <Choose pub={pub} host={host} now={now} onAction={onAction} />}
      {pub.phase === 'vote' && (
        <>
          <Vote pub={pub} host={host} remaining={remaining} />
          <CharacterRow characters={pub.characters} />
        </>
      )}
      {pub.phase === 'preparing' && (
        <>
          {pub.world && <p className="aventure-world-mini">{pub.world.title}</p>}
          <Preparing pub={pub} />
          {pub.characters.length > 0 && <CharacterRow characters={pub.characters} />}
        </>
      )}
    </section>
  );
}
