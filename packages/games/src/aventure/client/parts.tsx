import type { Resolution } from '../module.js';
import { STAT_LABELS, type StatKey } from '../schemas.js';

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
  xp: number;
  ownerId: string | null;
  ownerName: string | null;
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
  return (
    <article className={`aventure-sheet${highlight ? ' is-mine' : ''}${down ? ' is-down' : ''}`}>
      <header className="aventure-sheet-head">
        <span className="aventure-emoji" aria-hidden="true">
          {c.emoji}
        </span>
        <div>
          <h3>{c.name}</h3>
          <p className="muted">{c.title}</p>
        </div>
      </header>
      <PvBar pv={c.pv} pvMax={c.pvMax} />
      <p className="aventure-pv-text">
        {c.pv} / {c.pvMax} PV
      </p>
      {down && <p className="aventure-down">À terre</p>}
      <StatGrid stats={c.stats} />
      <p className="aventure-owner">{c.ownerName ? `Joué par ${c.ownerName}` : 'Compagnon (libre)'}</p>
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
            <span className="label">Objet</span> {c.item}
          </p>
          <p className="aventure-detail">
            <span className="label">Expérience</span> {c.xp}
          </p>
        </>
      )}
    </article>
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
        <span className="aventure-roll" aria-label={`Dé : ${r.roll}`}>
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
      {r.tie && <p className="muted">Égalité entre les choix : le hasard a tranché.</p>}
    </section>
  );
}
