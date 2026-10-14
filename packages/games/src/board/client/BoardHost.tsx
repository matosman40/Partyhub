import type { HostViewProps } from '../../client/types.js';
import { Avatar, Ranking } from '../../client/ui.js';
import { useRemaining } from '../../client/hooks.js';
import { BOARD_CELL_LABELS } from '@partyhub/shared';
import { badgeOf, faceOf, type BoardPub } from './common.js';

/** Écran principal d'un jeu de plateau : piste, pions, dernier lancer et classement. */
export function BoardHost({ publicState, now }: HostViewProps) {
  const pub = publicState as BoardPub;
  const remaining = useRemaining(pub.turnEndsAt ?? undefined, now);
  const current = pub.current ? pub.names[pub.current] : null;
  const last = pub.cells.length - 1;

  return (
    <section className="bd-host fade-in" data-theme={pub.theme}>
      <header className="bd-head">
        <h2>
          <span aria-hidden="true">{pub.icon}</span> {pub.name}
        </h2>
        {pub.phase === 'lobby' && <p className="muted">Le plateau attend le lancement de la partie.</p>}
        {pub.phase === 'play' && current && (
          <p className="bd-turn">
            Au tour de <strong>{current}</strong>
            {pub.turnEndsAt && <span className="bd-timer">{remaining} s</span>}
          </p>
        )}
      </header>

      <ol className="bd-track" aria-label="Plateau">
        {pub.cells.map((cell, i) => {
          const here = pub.order.filter((id) => (pub.positions[id] ?? 0) === i);
          const badge = badgeOf(cell);
          return (
            <li
              key={i}
              className={`bd-cell kind-${cell.kind}${i === 0 ? ' is-start' : ''}${i === last ? ' is-goal' : ''}`}
              title={cell.label || BOARD_CELL_LABELS[cell.kind]}
            >
              <span className="bd-index">{i + 1}</span>
              <span className="bd-label">{cell.label || (i === 0 ? 'Départ' : '')}</span>
              {badge && <span className="bd-badge">{badge}</span>}
              {here.length > 0 && (
                <span className="bd-pawns">
                  {here.map((id) => (
                    <Avatar key={id} name={pub.names[id] ?? '?'} size="sm" highlight={id === pub.current} />
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="bd-side">
        {pub.lastRoll && (
          <div className="bd-dice" aria-live="polite">
            <div className="bd-faces">
              {pub.lastRoll.dice.map((d, i) => (
                <span key={i} className="bd-die" aria-label={`Dé : ${d}`}>
                  {faceOf(d)}
                </span>
              ))}
            </div>
            <p>{pub.lastRoll.event}</p>
          </div>
        )}

        {pub.phase === 'final' && pub.ranking ? (
          <div className="bd-result">
            <h3>Classement final</h3>
            <Ranking entries={pub.ranking} />
          </div>
        ) : (
          <ol className="bd-log" aria-label="Journal de la partie">
            {pub.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
