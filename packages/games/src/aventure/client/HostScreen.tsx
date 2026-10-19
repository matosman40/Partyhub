import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import type { Resolution, RoundReport } from '../module.js';
import type { SceneKind } from '../schemas.js';
import {
  FoeCard,
  KindTag,
  NpcCard,
  ResolutionCard,
  RoundReportCard,
  SheetCard,
  StageFigure,
  type FoeView,
  type NpcView,
  type SheetView,
  artUrl,
} from './parts.js';

interface SceneView {
  kind: SceneKind;
  title: string;
  text: string;
  hint: string | null;
  npc: NpcView | null;
  choices: { id: string; label: string; statLabel: string; difficulty: number }[];
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
  mode: 'ia' | 'secours' | null;
  theme: string;
  difficulty: string;
  tone: string;
  world: { title: string; intro: string; goal: string } | null;
  /** Fond du monde : identifiant d’image, ou null. */
  backgroundId: string | null;
  characters: SheetView[];
  npcs: (NpcView & { met: boolean })[];
  playerCount: number;
  pickedCount: number;
  sceneNumber: number;
  total: number;
  scene: SceneView | null;
  voteCount: number;
  voterCount: number;
  resolution: Resolution | null;
  combat: CombatView | null;
  history: { sceneTitle: string; text: string }[];
  epilogue: { title: string; text: string } | null;
  victory: boolean | null;
  endsAt: number;
  durationMs: number;
  ranking: Parameters<typeof FinalHost>[0]['ranking'];
}

/** Vue réservée à l’écran principal : qui doit encore agir. */
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
      {pub.history.length > 0 && (
        <ol className="aventure-chronicle">
          {pub.history.map((h, i) => (
            <li key={`${h.sceneTitle}-${i}`}>
              <strong>{h.sceneTitle}</strong> <span>{h.text}</span>
            </li>
          ))}
        </ol>
      )}
      <FinalHost ranking={pub.ranking} />
    </section>
  );
}

function WorldHeader({ pub }: { pub: AventurePublic }) {
  if (!pub.world) return null;
  return (
    <header className="aventure-world">
      <h2 className="aventure-world-title">{pub.world.title}</h2>
      <p className="aventure-world-intro">{pub.world.intro}</p>
      <p className="aventure-goal">
        <span className="label">Objectif</span> {pub.world.goal}
      </p>
      <ModeNote mode={pub.mode} />
      <p className="aventure-meta muted">
        Thème : {pub.theme} · Difficulté : {pub.difficulty} · Ton : {pub.tone}
      </p>
    </header>
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
      <WorldHeader pub={pub} />
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

/** Personnages secondaires déjà rencontrés, avec leur lien avec le groupe. */
function Cast({ npcs }: { npcs: (NpcView & { met: boolean })[] }) {
  const met = npcs.filter((n) => n.met);
  if (met.length === 0) return null;
  return (
    <section className="aventure-cast" aria-label="Personnages rencontrés">
      <p className="label">Rencontrés jusqu’ici</p>
      <div className="aventure-cards compact">
        {met.map((n) => (
          <NpcCard key={n.name} npc={n} />
        ))}
      </div>
    </section>
  );
}

function Vote({ pub, host, remaining }: { pub: AventurePublic; host: AventureHostOnly | null; remaining: number }) {
  const scene = pub.scene;
  if (!scene) return null;
  return (
    <>
      <div className={`aventure-stage${scene.npc ? ' has-figure' : ''}`}>
        <section className="aventure-scene" aria-label="Scène en cours">
          <p className="label">
            Scène {pub.sceneNumber} sur {pub.total}
          </p>
          <div className="aventure-meta">
            <KindTag kind={scene.kind} />
          </div>
          <h2 className="aventure-scene-title">{scene.title}</h2>
          <p className="aventure-scene-text">{scene.text}</p>
          {scene.hint && <p className="aventure-hint">Indice : {scene.hint}</p>}
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
        {scene.npc && <StageFigure npc={scene.npc} />}
      </div>
      <Cast npcs={pub.npcs} />
      <TimerBar remaining={remaining} total={pub.durationMs} />
    </>
  );
}

/** Affrontement : l’ennemi, la manche en cours, et le bilan de la manche précédente. */
function Combat({ pub, host, remaining }: { pub: AventurePublic; host: AventureHostOnly | null; remaining: number }) {
  const combat = pub.combat;
  if (!combat) return null;
  const acting = combat.step === 'act';
  return (
    <>
      <section className="aventure-scene" aria-label="Affrontement en cours">
        <p className="label">
          {combat.sceneTitle} · manche {combat.round}
        </p>
        <FoeCard foe={combat.foe} />
        {acting ? (
          <>
            <p className="aventure-scene-text">{combat.foe.intro}</p>
            <p className="muted">
              {combat.actedCount} / {combat.actorCount} action(s) choisie(s)
            </p>
            <PendingNote names={host?.pending ?? []} label="Action attendue de :" />
          </>
        ) : (
          combat.report && <RoundReportCard report={combat.report} progress={combat.progress} />
        )}
      </section>
      <Cast npcs={pub.npcs} />
      <TimerBar remaining={remaining} total={pub.durationMs} />
    </>
  );
}

/** Pendant la révélation, le jet reste à l’écran : la suite arrive ensuite. */
function preparingText(pub: AventurePublic): string {
  if (pub.reveal) return 'Le résultat est joué. La suite arrive…';
  return pub.preparing ? PREPARING_TEXT[pub.preparing] : 'Le conteur réfléchit…';
}

function Preparing({ pub }: { pub: AventurePublic }) {
  const text = preparingText(pub);
  return (
    <section className="aventure-preparing" aria-live="polite">
      <p className="aventure-preparing-text">{text}</p>
      {pub.resolution && <ResolutionCard r={pub.resolution} />}
      {pub.combat?.over && pub.combat.report && (
        <RoundReportCard report={pub.combat.report} progress={pub.combat.progress} />
      )}
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

  // Le fond généré couvre l’écran, sous un voile sombre pour garder les textes lisibles.
  const background = pub.backgroundId
    ? {
        backgroundImage: `linear-gradient(rgba(12, 10, 28, 0.74), rgba(12, 10, 28, 0.9)), url("${artUrl(pub.backgroundId)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;
  return (
    <section className={`game-host fade-in aventure${pub.backgroundId ? ' has-art' : ''}`} style={background}>
      {pub.phase === 'choose' && <Choose pub={pub} host={host} now={now} onAction={onAction} />}
      {pub.phase === 'vote' && (
        <>
          <WorldHeader pub={pub} />
          <Vote pub={pub} host={host} remaining={remaining} />
          {/* Avec un personnage en grand, la scène prime : la rangée des fiches, trop haute, réduirait tout l’écran. */}
          {!pub.scene?.npc && <CharacterRow characters={pub.characters} />}
        </>
      )}
      {pub.phase === 'combat' && (
        <>
          <Combat pub={pub} host={host} remaining={remaining} />
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
