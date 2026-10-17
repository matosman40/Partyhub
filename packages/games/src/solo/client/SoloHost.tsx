import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';

interface Standing {
  playerId: string;
  name: string;
  percent: number;
  done: boolean;
  elapsedMs: number | null;
  moves: number;
}

/** Temps d’une grille résolue : 2 min 05 s 310 ms → « 02:05.310 ». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Écran principal d’un jeu solo : la progression de chacun, en direct, et le temps restant. */
export function SoloHost({ publicState: pub, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;

  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title={`${pub.icon} ${pub.name} : en attente du lancement…`}
        text={`${pub.playerCount} joueur(s) · chacun joue sa propre grille`}
      />
    );
  }

  const standings: Standing[] = pub.standings ?? [];
  return (
    <section className="solo-host fade-in">
      <div className="round-info">
        {pub.icon} {pub.name}
        {pub.limitMs > 0 && <> · {Math.ceil(remaining / 1000)} s restantes</>}
      </div>
      {pub.limitMs > 0 && <TimerBar remaining={remaining} total={pub.limitMs} />}
      <ol className="solo-standings">
        {standings.map((row, i) => (
          <li key={row.playerId} className={row.done ? 'is-done' : ''}>
            <span className="solo-place">{i + 1}</span>
            <span className="solo-name">{row.name}</span>
            <span className="solo-bar" aria-hidden="true">
              <span style={{ width: `${row.percent}%` }} />
            </span>
            <span className="solo-status">
              {row.done && row.elapsedMs !== null ? `Résolu · ${formatElapsed(row.elapsedMs)}` : `${row.percent} %`}
            </span>
            <span className="muted small solo-moves">{row.moves} coup(s)</span>
          </li>
        ))}
      </ol>
      <p className="muted small">Le premier à résoudre sa grille prend la tête du classement.</p>
    </section>
  );
}
