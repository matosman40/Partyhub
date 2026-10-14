import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { GROUP_COLOR, GROUP_LABEL, STACK_OFFSETS, cellOf, type Group } from '../board.js';
import type { PlayerPub, PromoteurPub } from './types.js';
import { Avatar } from '../../client/ui.js';
import { usePrefersReducedMotion } from '../../client/motion.js';
import { useSteppedPositions } from './useStepped.js';


/** Pions : un avatar par joueur, posé sur sa case et qui avance case par case. */
function Pawns({ players, current, positions }: { players: PlayerPub[]; current: string | null; positions: Record<string, number> }) {
  const perTile = new Map<number, number>();
  return (
    <div className="pm-pawns">
      {players.map((p) => {
        const index = positions[p.id] ?? p.pos;
        const { col, row } = cellOf(index);
        const slot = perTile.get(index) ?? 0;
        perTile.set(index, slot + 1);
        const [dx, dy] = STACK_OFFSETS[slot % STACK_OFFSETS.length] ?? [0, 0];
        const x = ((col + 0.5 + dx) / 7) * 100;
        const y = ((row + 0.62 + dy) / 7) * 100;
        const cls = ['pm-pawn', p.id === current ? 'is-current' : '', p.bankrupt ? 'is-out' : ''].join(' ');
        return (
          <div key={p.id} className={cls} style={{ left: `${x}%`, top: `${y}%`, zIndex: slot + (p.id === current ? 10 : 1) }} title={p.name}>
            <span className="pm-pawn-face">
              <Avatar name={p.name} size="sm" highlight={p.id === current} />
            </span>
          </div>
        );
      })}
    </div>
  );
}


/** Plateau du Promoteur : anneau de cases, pions, propriétaires et maisons. */
export function PromoteurHost({ publicState, now }: HostViewProps) {
  const pub = publicState as PromoteurPub | null;
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  const reduced = usePrefersReducedMotion();
  const targets: Record<string, number> = {};
  for (const p of pub?.players ?? []) targets[p.id] = p.pos;
  const positions = useSteppedPositions(targets, 170, reduced);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title="Le Promoteur : en attente du lancement…"
        text={`${pub.players.length} joueur(s) · ${pub.rounds} tours`}
      />
    );
  }

  const playerById = new Map(pub.players.map((p) => [p.id, p]));
  const pendingIndex = pub.phase === 'decide' ? pub.pending?.index : undefined;

  return (
    <section className="pm-host fade-in" aria-label="Plateau">
      <div className="pm-board">
        {pub.board.map((tile) => {
          const { col, row } = cellOf(tile.index);
          const owner = tile.owner ? playerById.get(tile.owner) : undefined;
          const cls = ['pm-tile', `kind-${tile.kind}`, pendingIndex === tile.index ? 'is-pending' : ''].join(' ');
          return (
            <div key={tile.index} className={cls} style={{ gridColumn: col + 1, gridRow: row + 1 }}>
              {tile.group && <span className="pm-band" style={{ background: GROUP_COLOR[tile.group] }} />}
              <span className="pm-name">{tile.name}</span>
              {tile.price !== undefined && <span className="pm-price">{tile.price} €</span>}
              {owner && (
                <span className="pm-owner" title={`Propriété de ${owner.name}`}>
                  <Avatar name={owner.name} size="sm" />
                </span>
              )}
              {tile.houses > 0 && <span className="pm-houses" aria-label={`${tile.houses} maison(s)`}>{'●'.repeat(tile.houses)}</span>}
            </div>
          );
        })}

        <Pawns players={pub.players} current={pub.current} positions={positions} />

        <div className="pm-center">
          <p className="label">
            Tour {pub.round} / {pub.rounds}
          </p>
          <h2 className="pm-current">{pub.currentName ?? '—'}</h2>
          {pub.phase === 'roll' && <p className="muted">À lui (ou elle) de lancer les dés</p>}

          {pub.dice && (
            <div className="pm-dice" key={pub.lastEvent} aria-label={`Dés : ${pub.dice[0]} et ${pub.dice[1]}`}>
              <span className="pm-die">{pub.dice[0]}</span>
              <span className="pm-die">{pub.dice[1]}</span>
            </div>
          )}

          {pub.phase === 'decide' && pub.pending && (
            <div className="pm-offer">
              <p className="label">À vendre</p>
              <p className="pm-offer-name">{pub.pending.name}</p>
              <p className="big-number">{pub.pending.price} €</p>
            </div>
          )}

          <p className="pm-event" key={pub.lastEvent} aria-live="polite">
            {pub.lastEvent}
          </p>

          {pub.durationMs > 0 && <TimerBar remaining={remaining} total={pub.durationMs} />}

          <ol className="pm-fortunes" aria-label="Fortunes">
            {pub.ranking.slice(0, 4).map((r) => (
              <li key={r.playerId}>
                <span className="rank">{r.rank}</span>
                <span className="name">{r.name}</span>
                <span className="points">{r.points.toLocaleString('fr-FR')} €</span>
              </li>
            ))}
          </ol>
          {pub.players.some((p) => p.bankrupt) && (
            <p className="muted small">
              Faillite : {pub.players.filter((p) => p.bankrupt).map((p) => p.name).join(', ')}
            </p>
          )}
          <p className="muted small">Couleurs : {Object.entries(GROUP_LABEL).map(([g, l]) => <span key={g} className="pm-legend" style={{ color: GROUP_COLOR[g as Group] }}>{l} </span>)}</p>
        </div>
      </div>
    </section>
  );
}
