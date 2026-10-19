import type { HostViewProps } from '../../client/types.js';
import { useElapsed, useRemaining } from '../../client/hooks.js';
import { TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoloChart, type ChartSeries } from './SoloChart.js';
import { SoloComparison, type StandingRow } from './SoloComparison.js';
import { axisScale, seriesColor, type ProgressPoint } from './progress.js';

export { formatElapsed } from './progress.js';

interface RosterEntry {
  playerId: string;
  name: string;
}

/**
 * Écran principal d’un jeu solo : la courbe d’avancement de chacun dans le temps, le tableau comparatif
 * (temps à 25, 50 et 75 %, résolution, coups, points) et le temps restant. Chacun garde sa teinte du début
 * à la fin, selon son ordre d’arrivée dans la salle, et non selon son rang.
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

  const colorOf = (playerId: string) => seriesColor(roster.findIndex((r) => r.playerId === playerId));
  const series: ChartSeries[] = roster.map((r) => ({
    id: r.playerId,
    name: r.name,
    color: colorOf(r.playerId),
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
    const winners = (pub.ranking ?? []).filter((e: { rank: number }) => e.rank === 1);
    return (
      <section className="solo-host fade-in">
        <h2 className="big-title">Classement final</h2>
        <p className="winner">
          {winners.length > 1 ? 'Ex æquo en tête : ' : 'Vainqueur : '}
          {winners.map((w: { name: string }) => w.name).join(', ')} 🏆
        </p>
        <SoloChart series={series} xMaxMs={xMaxMs} liveMs={0} />
        <SoloComparison rows={rows} colorOf={colorOf} history={history} />
      </section>
    );
  }

  return (
    <section className="solo-host fade-in">
      <div className="round-info">
        {pub.icon} {pub.name}
        {limited && <> · {Math.ceil(remaining / 1000)} s restantes</>} · {pub.playerCount} joueur(s)
      </div>
      {limited && <TimerBar remaining={remaining} total={pub.limitMs} />}
      <SoloChart series={series} xMaxMs={xMaxMs} liveMs={liveMs} />
      <SoloComparison rows={rows} colorOf={colorOf} history={history} />
      <p className="muted small">
        Le premier à résoudre prend la tête. Les joueurs qui n’ont pas fini sont classés par avancement.
      </p>
    </section>
  );
}
