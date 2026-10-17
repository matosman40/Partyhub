import type { BoardView, PowerKind } from './render.js';

/**
 * Événements de jeu déduits de la différence entre deux vues publiques.
 * Le navigateur ne reçoit aucun événement dédié : il reconstitue ce qui s’est
 * passé (bombe posée, explosion, caisse brisée, bonus pris…) pour le son et les effets.
 */
export type FxEvent =
  | { type: 'place'; x: number; y: number }
  | { type: 'blast'; cells: Array<{ x: number; y: number }> }
  | { type: 'crate'; x: number; y: number }
  | { type: 'die'; x: number; y: number; color: number }
  | { type: 'hit'; x: number; y: number; color: number }
  | { type: 'pickup'; x: number; y: number; kind: PowerKind }
  | { type: 'phase'; phase: string; winner: boolean }
  /** Une bombe qui arrive sur une case : lancée, frappée ou reposée. */
  | { type: 'slide'; x: number; y: number }
  /** Points gagnés par le vainqueur d’une manche, affichés au-dessus de lui. */
  | { type: 'score'; x: number; y: number; color: number; text: string };

const key = (x: number, y: number) => `${x},${y}`;

export function diffEvents(prev: BoardView, next: BoardView): FxEvent[] {
  const out: FxEvent[] = [];

  const prevBombs = new Set(prev.bombs.map((b) => b.id));
  for (const b of next.bombs) if (!prevBombs.has(b.id)) out.push({ type: 'place', x: b.x, y: b.y });

  // Une bombe qui change de case et qui n’est pas portée par quelqu’un vient d’être lancée ou frappée.
  const prevBombById = new Map(prev.bombs.map((b) => [b.id, b] as const));
  for (const b of next.bombs) {
    const before = prevBombById.get(b.id);
    if (!before || (before.x === b.x && before.y === b.y)) continue;
    const carried = next.units.some((u) => u.carrying && u.x === b.x && u.y === b.y);
    if (!carried) out.push({ type: 'slide', x: b.x, y: b.y });
  }

  const prevFlames = new Set(prev.flames.map((f) => key(f.x, f.y)));
  const fresh = next.flames.filter((f) => !prevFlames.has(key(f.x, f.y)));
  if (fresh.length > 0) out.push({ type: 'blast', cells: fresh });

  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      if (prev.grid[y]?.[x] === 'x' && next.grid[y]?.[x] !== 'x') out.push({ type: 'crate', x, y });
    }
  }

  const prevUnits = new Map(prev.units.map((u) => [u.playerId, u] as const));
  for (const u of next.units) {
    const p = prevUnits.get(u.playerId);
    if (!p) continue;
    if (p.alive && !u.alive) out.push({ type: 'die', x: u.x, y: u.y, color: u.color });
    else if (u.alive && p.mount && !u.mount) out.push({ type: 'hit', x: u.x, y: u.y, color: u.color });
  }

  const nextPowers = new Set(next.powerups.map((p) => key(p.x, p.y)));
  for (const p of prev.powerups) {
    if (nextPowers.has(key(p.x, p.y))) continue;
    if (next.units.some((u) => u.alive && u.x === p.x && u.y === p.y)) {
      out.push({ type: 'pickup', x: p.x, y: p.y, kind: p.kind });
    }
  }

  if (next.phase && prev.phase !== next.phase) {
    out.push({ type: 'phase', phase: next.phase, winner: !!next.winnerName });
  }
  // Fin de manche : le vainqueur gagne ses points, affichés au-dessus de lui.
  if (next.phase === 'round-over' && prev.phase !== 'round-over' && next.winnerName) {
    const winner = next.units.find((u) => u.alive && u.name === next.winnerName);
    if (winner) out.push({ type: 'score', x: winner.x, y: winner.y, color: winner.color, text: '+100' });
  }
  return out;
}
