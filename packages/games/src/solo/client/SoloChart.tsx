import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { ProgressPoint } from './progress.js';
import { axisScale, formatClock, valueAt } from './progress.js';

export interface ChartSeries {
  id: string;
  name: string;
  /** Teinte de la marque (variable CSS), attribuée une fois pour toute la partie. */
  color: string;
  /** Personnage qui court sur la courbe : il porte l’identité sans compter sur la couleur. */
  avatar: string;
  trail: ProgressPoint[];
  /** Avancement exact à l’instant de la vue : la courbe ne garde que les paliers. */
  current: number;
  done: boolean;
}

const VB_W = 960;
const VB_H = 340;
const M = { top: 18, right: 176, bottom: 40, left: 52 };
const PW = VB_W - M.left - M.right;
const PH = VB_H - M.top - M.bottom;
/** Au-delà de quatre courbes, les libellés directs se mêlent : la légende porte alors l’identité seule. */
const DIRECT_LABEL_MAX = 4;
/** Deux libellés plus proches que ça (en unités du tracé) se chevaucheraient : le second est omis. */
const LABEL_GAP = 17;
const Y_TICKS = [0, 25, 50, 75, 100];

/** Infobulle centrée sur le réticule, collée au bord quand le réticule est près d’un bord. */
function tipPlacement(fraction: number): CSSProperties {
  const left = `${fraction * 100}%`;
  if (fraction > 0.7) return { left, transform: 'translateX(-100%)' };
  if (fraction < 0.15) return { left, transform: 'none' };
  return { left, transform: 'translateX(-50%)' };
}

interface PlottedSeries extends ChartSeries {
  points: { ms: number; percent: number }[];
}

/**
 * Courbe d’avancement de chaque joueur, en fonction du temps. Chaque courbe est une suite de paliers
 * (un point par tranche de 10 %) ; une courbe encore en cours est prolongée à plat jusqu’à maintenant.
 * La légende donne l’identité ; le tableau voisin donne les mêmes chiffres en clair.
 */
export function SoloChart({ series, xMaxMs, liveMs }: { series: ChartSeries[]; xMaxMs: number; liveMs: number }) {
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const { stepMs } = axisScale(xMaxMs);
  const x = (ms: number) => M.left + (Math.min(ms, xMaxMs) / xMaxMs) * PW;
  const y = (percent: number) => M.top + (1 - percent / 100) * PH;

  const plotted: PlottedSeries[] = series
    .filter((s) => s.trail.length > 0)
    .map((s) => {
      const points = s.trail.map((p) => ({ ms: p.ms, percent: p.percent }));
      const last = points[points.length - 1]!;
      // Une partie en cours finit à son avancement exact, à l’instant présent.
      if (!s.done && (liveMs > last.ms || s.current !== last.percent)) {
        points.push({ ms: Math.max(liveMs, last.ms), percent: s.current });
      }
      return { ...s, points };
    });

  const ticks: number[] = [];
  for (let t = 0; t <= xMaxMs; t += stepMs) ticks.push(t);

  // Libellés directs : seulement si la salle est petite, et jamais deux libellés collés.
  const labelled = new Set<string>();
  if (plotted.length <= DIRECT_LABEL_MAX) {
    let lastY = -Infinity;
    const byEnd = [...plotted].sort((a, b) => y(a.points.at(-1)!.percent) - y(b.points.at(-1)!.percent));
    for (const s of byEnd) {
      const endY = y(s.points.at(-1)!.percent);
      if (endY - lastY >= LABEL_GAP) {
        labelled.add(s.id);
        lastY = endY;
      }
    }
  }

  function onMove(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const vbX = ((event.clientX - rect.left) / rect.width) * VB_W;
    const fraction = Math.min(1, Math.max(0, (vbX - M.left) / PW));
    setHoverMs(fraction * xMaxMs);
  }

  /** Avancement d’un joueur à un instant : exact pour l’instant présent, sinon le palier atteint. */
  const percentAt = (s: ChartSeries, ms: number) => {
    const last = s.trail[s.trail.length - 1];
    if (!s.done && last && ms >= last.ms) return s.current;
    return valueAt(s.trail, ms);
  };
  const hoverRows =
    hoverMs === null
      ? []
      : series.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          avatar: s.avatar,
          percent: percentAt(s, hoverMs),
        }));

  return (
    <div className="solo-chart">
      <div className="solo-chart-wrap">
        <svg
          className="solo-chart-svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label="Avancement de chaque joueur au fil du temps"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverMs(null)}
        >
          {Y_TICKS.map((p) => (
            <g key={`y${p}`}>
              <line className={p === 0 ? 'baseline' : 'grid'} x1={M.left} x2={M.left + PW} y1={y(p)} y2={y(p)} />
              <text className="tick" x={M.left - 10} y={y(p) + 5} textAnchor="end">
                {p} %
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={`x${t}`} className="tick" x={x(t)} y={M.top + PH + 26} textAnchor="middle">
              {formatClock(t)}
            </text>
          ))}

          {plotted.map((s) => (
            <polyline
              key={s.id}
              className="line"
              style={{ stroke: s.color }}
              points={s.points.map((p) => `${x(p.ms).toFixed(1)},${y(p.percent).toFixed(1)}`).join(' ')}
            />
          ))}

          {plotted.map((s) => {
            const end = s.points.at(-1)!;
            const ex = x(end.ms);
            const ey = y(end.percent);
            return (
              <g key={`end-${s.id}`} className="racer">
                <circle className="ring" cx={ex} cy={ey} r={15} style={{ stroke: s.color }} />
                <text className="avatar" x={ex} y={ey} aria-hidden="true">
                  {s.avatar}
                </text>
                {labelled.has(s.id) && (
                  <text className="label" x={ex + 22} y={ey + 5}>
                    {s.name} · {end.percent} %{s.done ? ' 🏁' : ''}
                  </text>
                )}
              </g>
            );
          })}

          {hoverMs !== null && (
            <line className="crosshair" x1={x(hoverMs)} x2={x(hoverMs)} y1={M.top} y2={M.top + PH} />
          )}
        </svg>

        {hoverMs !== null && (
          <div className="solo-tip" style={tipPlacement(x(hoverMs) / VB_W)}>
            <div className="solo-tip-time">{formatClock(hoverMs)}</div>
            {hoverRows.map((r) => (
              <div key={r.id} className="solo-tip-row">
                <span className="solo-tip-name">
                  <span className="solo-key" style={{ background: r.color }} />
                  <span aria-hidden="true">{r.avatar}</span>
                  {r.name}
                </span>
                <strong>{r.percent} %</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {series.length > 1 && (
        <ul className="solo-legend">
          {series.map((s) => (
            <li key={s.id}>
              <span className="solo-legend-key" style={{ background: s.color }} aria-hidden="true" />
              <span aria-hidden="true">{s.avatar}</span>
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
