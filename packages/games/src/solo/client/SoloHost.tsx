import type { CSSProperties } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useElapsed, useRemaining } from '../../client/hooks.js';
import { TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoloChart, type ChartSeries } from './SoloChart.js';
import { SoloComparison, type StandingRow } from './SoloComparison.js';
import { avatarOf, axisScale, formatElapsed, medalOf, seriesColor, type ProgressPoint } from './progress.js';

export { formatElapsed } from './progress.js';

interface RosterEntry {
  playerId: string;
  name: string;
}

const CONFETTI_COUNT = 36;

/** Confettis du classement final : purement décoratifs, désactivés si l’animation réduite est demandée. */
function Confetti() {
  return (
    <div className="solo-confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              animationDelay: `${((i * 0.17) % 2).toFixed(2)}s`,
              background: seriesColor(i),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * Écran principal d’un jeu solo : la course des courbes (chacun a son personnage au bout de sa courbe), le
 * bandeau de tête, le tableau comparatif (temps à 25, 50 et 75 %, résolution, coups, points) et le temps restant.
 * Chacun garde sa teinte et son personnage du début à la fin, selon son ordre d’arrivée dans la salle.
 */
export function SoloHost({ publicState: pub, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  const liveMs = useElapsed(pub?.startedAt ?? 0, now, pub?.phase === 'play');
  if (!pub) return null;

  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title={`${pub.icon} ${pub.name} : en attente du lancement…`}
        text={`${pub.playerCount} joueur(s) · chacun joue sa propre grille`}
      />
    );
  }

  const isFinal = pub.phase === 'final';
  const roster: RosterEntry[] = pub.roster ?? [];
  const history: Record<string, ProgressPoint[]> = pub.history ?? {};
  const baseRows: StandingRow[] = pub.standings ?? [];
  const pointsByPlayer = new Map<string, number>(
    ((pub.ranking ?? []) as { playerId: string; points: number }[]).map((e) => [e.playerId, e.points]),
  );

  const indexOf = (playerId: string) => roster.findIndex((r) => r.playerId === playerId);
  const colorOf = (playerId: string) => seriesColor(indexOf(playerId));
  const avatarFor = (playerId: string) => avatarOf(indexOf(playerId));
  const series: ChartSeries[] = roster.map((r) => ({
    id: r.playerId,
    name: r.name,
    color: colorOf(r.playerId),
    avatar: avatarFor(r.playerId),
    trail: history[r.playerId] ?? [],
    current: baseRows.find((row) => row.playerId === r.playerId)?.percent ?? 0,
    done: baseRows.some((row) => row.playerId === r.playerId && row.done),
  }));

  // Les points ne s’affichent qu’une fois fixés : à la résolution, ou à la fin de la partie pour tous.
  const rows: StandingRow[] = baseRows.map((row) => ({
    ...row,
    points: isFinal ? (pointsByPlayer.get(row.playerId) ?? null) : row.points,
  }));

  const trailMax = Math.max(0, ...series.flatMap((s) => s.trail.map((p) => p.ms)));
  const limited = pub.limitMs > 0;
  const { maxMs: xMaxMs } = axisScale(Math.max(limited ? pub.limitMs : 0, isFinal ? 0 : liveMs, trailMax));

  if (isFinal) {
    const ranked: { playerId: string; name: string; rank: number; points: number }[] = pub.ranking ?? [];
    const winners = ranked.filter((e) => e.rank === 1);
    const podium = ranked.filter((e) => e.rank <= 3).slice(0, 6);
    return (
      <section className="solo-host solo-final fade-in">
        {winners.length > 0 && <Confetti />}
        <h2 className="big-title">Classement final</h2>
        <p className="winner">
          {winners.length > 1 ? 'Ex æquo en tête : ' : 'Vainqueur : '}
          {winners.map((w) => `${avatarFor(w.playerId)} ${w.name}`).join(', ')} 🏆
        </p>
        <ol className="solo-podium" aria-label="Podium">
          {podium.map((e) => (
            <li key={e.playerId} className="solo-podium-card">
              <span className="solo-podium-medal" aria-hidden="true">
                {medalOf(e.rank)}
              </span>
              <span className="solo-podium-avatar" aria-hidden="true">
                {avatarFor(e.playerId)}
              </span>
              <span className="solo-podium-name">{e.name}</span>
              <span className="solo-podium-points">{e.points} pts</span>
            </li>
          ))}
        </ol>
        <SoloChart series={series} xMaxMs={xMaxMs} liveMs={0} />
        <SoloComparison rows={rows} colorOf={colorOf} avatarOf={avatarFor} medals history={history} />
      </section>
    );
  }

  const leader = rows[0];
  return (
    <section className="solo-host fade-in">
      <div className="round-info">
        {pub.icon} {pub.name}
        {limited && <> · {Math.ceil(remaining / 1000)} s restantes</>} · {pub.playerCount} joueur(s)
      </div>
      {leader && (
        // La clé change avec le leader : le bandeau rebondit à chaque nouvelle tête, sans rebondir à chaque tick.
        <p key={leader.playerId} className={`solo-lead${leader.done ? ' is-done' : ''}`} aria-live="polite">
          {leader.done && leader.elapsedMs !== null
            ? `🏁 ${avatarFor(leader.playerId)} ${leader.name} a fini en ${formatElapsed(leader.elapsedMs)}`
            : leader.percent > 0
              ? `👑 ${avatarFor(leader.playerId)} ${leader.name} mène · ${leader.percent} %`
              : '🚦 C’est parti ! Personne n’a encore avancé.'}
        </p>
      )}
      {limited && <TimerBar remaining={remaining} total={pub.limitMs} />}
      <SoloChart series={series} xMaxMs={xMaxMs} liveMs={liveMs} />
      <SoloComparison rows={rows} colorOf={colorOf} avatarOf={avatarFor} history={history} />
      <p className="muted small">
        Le premier à résoudre prend la tête. Les joueurs qui n’ont pas fini sont classés par avancement.
      </p>
    </section>
  );
}
