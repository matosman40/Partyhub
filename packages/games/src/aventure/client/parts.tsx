import { useState, type ReactNode } from 'react';
import { defaultCharacterFor } from '@partyhub/shared';
import { Character } from '../../client/character.js';
import { Avatar } from '../../client/ui.js';
import type { Resolution, RoundReport } from '../module.js';
import { KIND_LABELS, STAT_LABELS, type SceneKind, type StatKey } from '../schemas.js';

/** Fiche d'un personnage, telle que la vue publique la donne (aucune donnée secrète). */
export interface SheetView {
  id: string;
  name: string;
  title: string;
  emoji: string;
  backstory: string;
  stats: Record<StatKey, number>;
  pv: number;
  pvMax: number;
  ability: { name: string; text: string };
  flaw: string;
  item: string;
  /** Objets trouvés pendant l'aventure (quatre au plus). */
  bag: string[];
  level: number;
  xp: number;
  /** Expérience totale du niveau suivant, ou null au niveau maximum. */
  nextXp: number | null;
  games: number;
  victories: number;
  /** Portrait généré (identifiant d'image), ou null. */
  portraitId: string | null;
  ownerId: string | null;
  ownerName: string | null;
}

export interface NpcView {
  name: string;
  title: string;
  emoji: string;
  attitude: string;
  /** Réplique à la scène, ou absente dans la liste des personnages. */
  line?: string;
  met?: boolean;
  /** Lien avec le groupe, en mots (hostile … allié). */
  relation?: string;
}

export interface FoeView {
  name: string;
  title: string;
  emoji: string;
  intro: string;
  hp: number;
  hpMax: number;
  defense: number;
  damage: number;
}

export function PvBar({ pv, pvMax }: { pv: number; pvMax: number }) {
  const pct = pvMax > 0 ? Math.max(0, Math.min(100, (pv / pvMax) * 100)) : 0;
  return (
    <span className="aventure-pv" role="img" aria-label={`${pv} points de vie sur ${pvMax}`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export function StatGrid({ stats }: { stats: Record<StatKey, number> }) {
  return (
    <dl className="aventure-stats">
      {(Object.keys(STAT_LABELS) as StatKey[]).map((key) => (
        <div key={key}>
          <dt>{STAT_LABELS[key]}</dt>
          <dd>{stats[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Nature d'une scène : rencontre, dialogue, énigme, halte ou combat. */
export function KindTag({ kind }: { kind: SceneKind }) {
  return <span className={`aventure-kind is-${kind}`}>{KIND_LABELS[kind]}</span>;
}

/** Lien avec un personnage secondaire : chaude pour un lien positif, froide pour un lien tendu. */
export function RelationTag({ relation }: { relation: string }) {
  const tone = relation === 'hostile' || relation === 'méfiant' ? ' is-cold' : relation === 'neutre' ? '' : ' is-warm';
  return <span className={`aventure-relation${tone}`}>Lien : {relation}</span>;
}

/** Ce qu'un résultat change pour le groupe : expérience, niveaux, objets, soins, blessures, liens. */
export function ProgressList({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="aventure-progress" aria-label="Ce qui change pour le groupe">
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

/** Adresse publique d'une image générée, servie par le serveur. */
export function artUrl(id: string): string {
  return `/api/ai-images/${id}`;
}

/**
 * Image générée (portrait ou fond) : si elle ne charge pas, le rendu de secours prend sa place.
 * `alt` est vide pour une image décorative.
 */
export function ArtFrame({ id, alt = '', fallback }: { id: string; alt?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      className="aventure-art"
      src={artUrl(id)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Pastille d'un personnage dans une liste de choix : son portrait généré, ou son emoji. */
export function ArtBadge({ id, emoji }: { id: string | null; emoji: string }) {
  const emojiSpan = <span aria-hidden="true">{emoji}</span>;
  return id ? <ArtFrame id={id} fallback={emojiSpan} /> : emojiSpan;
}

/**
 * Portrait d'un personnage joueur : la photo ou le personnage dessiné de son joueur. Un compagnon (personne
 * ne le joue) porte son portrait généré s'il existe, sinon il est dessiné à partir de son nom.
 */
export function Portrait({ c }: { c: SheetView }) {
  if (c.ownerName) {
    return (
      <span className="aventure-portrait">
        <Avatar name={c.ownerName} size="lg" />
      </span>
    );
  }
  const drawn = <Character spec={defaultCharacterFor(c.name)} framing="bust" label={c.name} />;
  return (
    <span className="aventure-portrait">{c.portraitId ? <ArtFrame id={c.portraitId} fallback={drawn} /> : drawn}</span>
  );
}

/** Fiche complète : pour l'écran principal (version compacte) et le téléphone (version détaillée). */
export function SheetCard({
  c,
  detailed = false,
  highlight = false,
}: {
  c: SheetView;
  detailed?: boolean;
  highlight?: boolean;
}) {
  const down = c.pv === 0;
  const xpPct = c.nextXp ? Math.min(100, (c.xp / c.nextXp) * 100) : 100;
  return (
    <article className={`aventure-sheet${highlight ? ' is-mine' : ''}${down ? ' is-down' : ''}`}>
      <header className="aventure-sheet-head">
        <Portrait c={c} />
        <div>
          <h3>
            <span aria-hidden="true">{c.emoji} </span>
            {c.name}
          </h3>
          <p className="muted">{c.title}</p>
          <p className="aventure-owner">{c.ownerName ? `Joué par ${c.ownerName}` : 'Compagnon (libre)'}</p>
          <p className="aventure-level">Niveau {c.level}</p>
        </div>
      </header>
      <PvBar pv={c.pv} pvMax={c.pvMax} />
      <p className="aventure-pv-text">
        {c.pv} / {c.pvMax} PV
      </p>
      {down && <p className="aventure-down">À terre</p>}
      <StatGrid stats={c.stats} />
      {detailed && (
        <>
          <p>{c.backstory}</p>
          <p className="aventure-ability">
            <strong>{c.ability.name}</strong> <span className="muted">(pouvoir narratif)</span>
            <br />
            {c.ability.text}
          </p>
          <p className="aventure-detail">
            <span className="label">Défaut</span> {c.flaw}
          </p>
          <p className="aventure-detail">
            <span className="label">Objet de départ</span> {c.item}
          </p>
          {c.bag.length > 0 && (
            <div className="aventure-detail">
              <span className="label">Sac</span>
              <ul className="aventure-bag">
                {c.bag.map((item, i) => (
                  <li key={`${i}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="aventure-xp" role="img" aria-label={`Expérience : ${c.xp}`}>
            <span style={{ width: `${xpPct}%` }} />
          </div>
          <p className="aventure-detail">
            <span className="label">Expérience</span> {c.xp}
            {c.nextXp ? ` / ${c.nextXp} pour le niveau suivant` : ' (niveau maximum)'}
          </p>
          <p className="aventure-detail">
            <span className="label">Parties</span> {c.games} jouée(s), {c.victories} gagnée(s)
          </p>
        </>
      )}
    </article>
  );
}

/** Personnage secondaire : son portrait dessiné, son lien avec le groupe, et sa réplique quand il parle. */
export function NpcCard({ npc }: { npc: NpcView }) {
  return (
    <figure className="aventure-npc">
      <span className="aventure-portrait">
        <Character spec={defaultCharacterFor(npc.name)} framing="bust" label={npc.name} />
      </span>
      <figcaption>
        <strong>
          <span aria-hidden="true">{npc.emoji} </span>
          {npc.name}
        </strong>{' '}
        <span className="muted">{npc.title}</span>
        {npc.relation && <RelationTag relation={npc.relation} />}
        {npc.line && <blockquote className="aventure-npc-line">« {npc.line} »</blockquote>}
      </figcaption>
    </figure>
  );
}

/** Adversaire : ses points de vie restants, et ce qu'il faut pour le toucher. */
export function FoeCard({ foe }: { foe: FoeView }) {
  return (
    <article className="aventure-foe" aria-label={`Ennemi : ${foe.name}`}>
      <span className="aventure-foe-emoji" aria-hidden="true">
        {foe.emoji}
      </span>
      <div>
        <h3>{foe.name}</h3>
        <p className="muted">{foe.title}</p>
        <PvBar pv={foe.hp} pvMax={foe.hpMax} />
        <p className="aventure-pv-text">
          {foe.hp} / {foe.hpMax} PV · défense {foe.defense} · riposte {foe.damage}
        </p>
      </div>
    </article>
  );
}

/** Bilan d'une manche : chaque action, le dé, la riposte, et ce que la manche change. `highlightId` marque le personnage du lecteur. */
export function RoundReportCard({
  report,
  highlightId = null,
  progress = [],
}: {
  report: RoundReport;
  highlightId?: string | null;
  progress?: string[];
}) {
  return (
    <section className="aventure-report" aria-live="polite">
      <p className="label">Manche {report.round}</p>
      <ul className="aventure-report-lines">
        {report.lines.map((line) => (
          <li
            key={line.characterId}
            className={`${line.success ? 'is-success' : 'is-fail'}${highlightId === line.characterId ? ' is-mine' : ''}`}
          >
            <span className="aventure-report-who">
              {line.characterName}
              {line.ownerName ? ` (${line.ownerName})` : ''}
            </span>
            <span className="aventure-report-action">{line.label}</span>
            <span className="aventure-dice-mini">
              d20 {line.roll} + {line.bonus} = {line.total} (défense {line.defense})
            </span>
            <span className="aventure-report-text">{line.text}</span>
          </li>
        ))}
      </ul>
      {report.riposte && <p className="aventure-riposte">{report.riposte}</p>}
      {report.consequence && <p className="aventure-consequence">{report.consequence}</p>}
      <ProgressList lines={progress} />
    </section>
  );
}

export function ResolutionCard({ r }: { r: Resolution }) {
  const verdict = r.success ? 'Réussi' : 'Raté';
  const flourish = r.roll === 20 ? 'Coup de maître !' : r.roll === 1 ? 'Catastrophe.' : null;
  return (
    <section className={`aventure-result ${r.success ? 'is-success' : 'is-fail'}`} aria-live="polite">
      <p className="aventure-result-title">
        {r.characterName} tente « {r.choiceLabel} »
      </p>
      <p className="aventure-dice">
        <span className="aventure-roll" role="img" aria-label={`Dé : ${r.roll}`}>
          {r.roll}
        </span>
        <span className="aventure-math">
          + {r.bonus} ({STAT_LABELS[r.stat]}) = <strong>{r.total}</strong> contre {r.difficulty}
        </span>
      </p>
      <p className="aventure-verdict">
        {verdict}
        {flourish ? ` — ${flourish}` : ''}
      </p>
      <p className="aventure-consequence">{r.consequence}</p>
      <ProgressList lines={r.progress} />
      {r.tie && <p className="muted">Égalité entre les choix : le hasard a tranché.</p>}
    </section>
  );
}
