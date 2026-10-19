import type { ProgressPoint } from './progress.js';
import { formatClock, formatElapsed, timeAtPercent } from './progress.js';

export interface StandingRow {
  playerId: string;
  name: string;
  percent: number;
  done: boolean;
  elapsedMs: number | null;
  moves: number;
  /** Points, affichés une fois fixés (résolution) ou à la fin de la partie. */
  points: number | null;
}

/**
 * Tableau comparatif de l’écran principal : une ligne par joueur, dans l’ordre du classement. Il donne en
 * clair ce que la courbe montre : le temps mis pour atteindre 25, 50 et 75 %, et le temps de résolution.
 */
export function SoloComparison({
  rows,
  colorOf,
  history,
}: {
  rows: StandingRow[];
  colorOf: (playerId: string) => string;
  history: Record<string, ProgressPoint[]>;
}) {
  return (
    <div className="solo-compare-wrap">
      <table className="solo-compare" aria-label="Comparaison des joueurs">
        <thead>
          <tr>
            <th scope="col">Rang</th>
            <th scope="col">Joueur</th>
            <th scope="col">Avancement</th>
            <th scope="col" className="num">
              25 %
            </th>
            <th scope="col" className="num">
              50 %
            </th>
            <th scope="col" className="num">
              75 %
            </th>
            <th scope="col" className="num">
              Résolu
            </th>
            <th scope="col" className="num">
              Coups
            </th>
            <th scope="col" className="num">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const trail = history[row.playerId] ?? [];
            const color = colorOf(row.playerId);
            return (
              <tr key={row.playerId} className={row.done ? 'is-done' : undefined}>
                <td className="solo-place">{i + 1}</td>
                <td>
                  <span className="solo-name-cell">
                    <span className="solo-key" style={{ background: color }} aria-hidden="true" />
                    <span className="solo-name">{row.name}</span>
                  </span>
                </td>
                <td>
                  <span className="solo-progress">
                    <span className="solo-bar" aria-hidden="true">
                      <span style={{ width: `${row.percent}%`, background: color }} />
                    </span>
                    <span className="solo-pct">{row.percent} %</span>
                  </span>
                </td>
                <td className="num">{atOrDash(timeAtPercent(trail, 25))}</td>
                <td className="num">{atOrDash(timeAtPercent(trail, 50))}</td>
                <td className="num">{atOrDash(timeAtPercent(trail, 75))}</td>
                <td className="num">{row.done && row.elapsedMs !== null ? formatElapsed(row.elapsedMs) : '—'}</td>
                <td className="num">{row.moves}</td>
                <td className="num">{row.points ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function atOrDash(ms: number | null): string {
  return ms === null ? '—' : formatClock(ms);
}
