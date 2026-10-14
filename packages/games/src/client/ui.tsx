import { useContext, useState, type CSSProperties } from 'react';
import { AvatarsContext, type AvatarData } from './avatar-context.js';

/**
 * Briques d'interface communes à tous les jeux : avatar, classement,
 * barre de temps, carte à jouer. Elles ne contiennent aucune logique de jeu.
 */

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

/** Teinte stable dérivée du pseudo : même joueur, même couleur sur tous les écrans. */
function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}

/** Visage d'un avatar : photo si elle existe et charge, sinon l'emoji sur sa teinte. */
function AvatarFace({
  info,
  size,
  highlight,
  name,
}: {
  info: AvatarData;
  size: 'sm' | 'md' | 'lg';
  highlight: boolean;
  name: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!info.imageUrl && !broken;
  return (
    <span
      className={`avatar avatar-${size}${highlight ? ' is-you' : ''}`}
      style={{ background: `hsl(${info.hue} 85% 66%)` }}
      aria-hidden="true"
      title={name}
    >
      {showImage ? <img src={info.imageUrl ?? ''} alt="" loading="lazy" onError={() => setBroken(true)} /> : info.emoji}
    </span>
  );
}

export function Avatar({
  name,
  size = 'md',
  highlight = false,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) {
  const known = useContext(AvatarsContext)[name];
  if (known) return <AvatarFace info={known} size={size} highlight={highlight} name={name} />;
  const style: CSSProperties = {
    background: `linear-gradient(135deg, hsl(${hueOf(name)} 85% 62%), hsl(${(hueOf(name) + 40) % 360} 80% 45%))`,
  };
  return (
    <span className={`avatar avatar-${size}${highlight ? ' is-you' : ''}`} style={style} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export interface RankRow {
  playerId: string;
  name: string;
  points: number;
  rank: number;
}

export function Ranking({ entries, limit }: { entries: RankRow[]; limit?: number }) {
  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <ol className="ranking">
      {shown.map((e) => (
        <li key={e.playerId} className={e.rank === 1 ? 'rank-first' : undefined}>
          <span className="rank">{e.rank}</span>
          <Avatar name={e.name} size="sm" />
          <span className="name">{e.name}</span>
          <span className="points">{e.points} pts</span>
        </li>
      ))}
    </ol>
  );
}

export function TimerBar({ remaining, total }: { remaining: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <div className="timer-bar" aria-label="Temps restant">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Écran d'attente côté téléphone (entre deux étapes ou avant le lancement). */
export function WaitingScreen({ title, text }: { title: string; text?: string }) {
  return (
    <section className="player-game fade-in">
      <p className="big">{title}</p>
      {text && <p className="muted">{text}</p>}
    </section>
  );
}

/** Fin de partie côté téléphone : score personnel et rang. */
export function FinalScreen({ points, rank }: { points: number; rank: number | null }) {
  return (
    <section className="player-game fade-in">
      <h2>Partie terminée</h2>
      <p className="big-number">{points} pts</p>
      <p>Vous êtes {rank ? `${rank}ᵉ` : '—'} du classement.</p>
      <p className="muted">Regardez l'écran principal pour le podium final.</p>
    </section>
  );
}

/** Secondes restantes, arrondies au supérieur. */
export function Countdown({ remaining }: { remaining: number }) {
  return <span className="countdown">{Math.ceil(remaining / 1000)} s</span>;
}

/** Écran principal : classement final en podium. */
export function FinalHost({ ranking }: { ranking: RankRow[] }) {
  const winners = ranking.filter((e) => e.rank === 1);
  return (
    <section className="game-host fade-in final">
      <h2 className="big-title">Classement final</h2>
      <p className="winner">
        {winners.length > 1 ? 'Ex æquo en tête : ' : 'Vainqueur : '}
        {winners.map((w) => w.name).join(', ')} 🏆
      </p>
      <Ranking entries={ranking} />
    </section>
  );
}

export interface CardView {
  rank: number;
  suit: string;
}

const FACE: Record<number, string> = { 11: 'V', 12: 'D', 13: 'R', 14: 'A' };

export function PlayingCard({ card, label }: { card: CardView | null; label?: string }) {
  if (!card) return <div className="playing-card empty" aria-hidden="true" />;
  const rank = FACE[card.rank] ?? String(card.rank);
  const red = card.suit === '♥' || card.suit === '♦';
  return (
    <div className={`playing-card${red ? ' red' : ''}`} aria-label={label ?? `${rank} de ${card.suit}`}>
      <span className="corner top">
        {rank}
        <br />
        {card.suit}
      </span>
      <span className="suit">{card.suit}</span>
      <span className="corner bottom">
        {rank}
        <br />
        {card.suit}
      </span>
    </div>
  );
}
