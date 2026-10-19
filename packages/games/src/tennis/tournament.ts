import type { Who } from './score.js';

/**
 * Tournois du tennis party : une poule (chacun joue contre chacun) ou un tableau à élimination directe.
 *
 * Fichier pur : les matchs se jouent ailleurs (voir `match.ts`), et leur résultat est remis ici. En poule, un match
 * sans vainqueur compte pour un nul. Dans le tableau, un match sans vainqueur est rejoué.
 */

export type TournamentKind = 'poule' | 'eliminatoire';

/** Résultat d’un match, tel que le classement le lit. */
export interface MatchResult {
  /** Joueur du bas (a) et joueur du haut (b). */
  a: string;
  b: string;
  /** Vainqueur : 0 pour a, 1 pour b, null pour une égalité. */
  winner: Who | null;
  /** Manches gagnées par chacun : sets (règles du tennis), ou vies restantes (règles simples). */
  wins: [number, number];
  /** Jeux (règles du tennis) ou touches (règles simples) marqués par chacun. */
  scored: [number, number];
}

export interface Match {
  id: string;
  /** Tour du tableau, ou manche de la poule, à partir de 0. */
  round: number;
  /** Position dans le tour. */
  index: number;
  /** Joueur du bas et joueur du haut. Null tant que le match n’est pas connu (élimination). */
  a: string | null;
  b: string | null;
  /** Vainqueur d’un match d’élimination. Null tant qu’il n’est pas décidé, ou pour un nul en poule. */
  winner: string | null;
  /** Exemption : le joueur passe au tour suivant sans jouer. */
  bye: boolean;
  /** Dernier résultat connu : le match est joué en poule, et rejoué tant qu’il n’est pas décidé en élimination. */
  result: MatchResult | null;
}

export interface Tournament {
  kind: TournamentKind;
  ids: string[];
  matches: Match[];
}

export interface Standing {
  id: string;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Points de championnat : 3 par victoire, 1 par nul. */
  points: number;
  /** Manches gagnées et perdues. */
  wins: [number, number];
  /** Jeux (ou touches) marqués et encaissés. */
  scored: [number, number];
}

/** Crée le tournoi : toutes les rencontres de la poule, ou le tableau avec ses exemptions. */
export function createTournament(kind: TournamentKind, ids: readonly string[]): Tournament {
  const matches = kind === 'poule' ? pouleMatches(ids) : bracketMatches(ids);
  return { kind, ids: [...ids], matches };
}

/**
 * Rencontres de la poule : méthode du cercle. Le premier joueur reste en place, les autres tournent à chaque manche,
 * et chaque manche fait jouer des paires distinctes. Chaque paire ne se rencontre qu’une fois.
 */
function pouleMatches(ids: readonly string[]): Match[] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const matches: Match[] = [];
  for (let round = 0; round < n - 1; round++) {
    let index = 0;
    for (let i = 0; i < n / 2; i++) {
      const x = list[i] ?? null;
      const y = list[n - 1 - i] ?? null;
      if (x === null || y === null) continue; // Exemption d’un nombre impair de joueurs.
      // Alterne qui joue en bas d’une manche à l’autre, pour que personne ne soit toujours du même côté.
      const flip = (round + i) % 2 === 1;
      matches.push(emptyMatch(`p${matches.length + 1}`, round, index, flip ? y : x, flip ? x : y));
      index++;
    }
    const last = list.pop() ?? null;
    list.splice(1, 0, last);
  }
  return matches;
}

function emptyMatch(id: string, round: number, index: number, a: string | null, b: string | null): Match {
  return { id, round, index, a, b, winner: null, bye: false, result: null };
}

/** Ordre des graines dans un tableau de `size` places : 1 contre `size`, 2 contre `size - 1`, etc. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((x) => [x, n + 1 - x]);
  }
  return order;
}

/**
 * Tableau à élimination directe. Le nombre de places est la puissance de deux supérieure ou égale au nombre de
 * joueurs ; les premières graines (ordre des joueurs) reçoivent les exemptions.
 */
function bracketMatches(ids: readonly string[]): Match[] {
  let size = 1;
  while (size < ids.length) size *= 2;
  const rounds = Math.log2(size);
  const matches: Match[] = [];
  for (let round = 0; round < rounds; round++) {
    const count = size >> (round + 1);
    for (let index = 0; index < count; index++) {
      matches.push(emptyMatch(`r${round}m${index}`, round, index, null, null));
    }
  }

  const seeds = seedOrder(size);
  for (let index = 0; index < size / 2; index++) {
    const match = matches[index];
    if (!match) continue;
    match.a = ids[(seeds[2 * index] ?? 1) - 1] ?? null;
    match.b = ids[(seeds[2 * index + 1] ?? 1) - 1] ?? null;
    if ((match.a === null) !== (match.b === null)) {
      match.bye = true;
      match.winner = match.a ?? match.b;
    }
  }

  // Les exemptes passent tout de suite au tour suivant.
  for (const match of matches) {
    if (match.winner !== null) placeWinner(matches, match.round, match.index, match.winner);
  }
  return matches;
}

/** Place un vainqueur dans le match du tour suivant qui le reçoit. */
function placeWinner(matches: Match[], round: number, index: number, winner: string): void {
  const next = matches.find((m) => m.round === round + 1 && m.index === index >> 1);
  if (!next) return;
  if (index % 2 === 0) next.a = winner;
  else next.b = winner;
}

/** Un match peut être joué : deux joueurs connus, et pas encore décidé (ou pas encore joué, en poule). */
function isPlayable(t: Tournament, m: Match): boolean {
  if (m.a === null || m.b === null) return false;
  if (t.kind === 'poule') return m.result === null;
  return m.winner === null && !m.bye;
}

/** Prochain match à jouer, dans l’ordre du programme. */
export function nextMatch(t: Tournament): Match | null {
  return t.matches.find((m) => isPlayable(t, m)) ?? null;
}

/**
 * Enregistre le résultat d’un match. En élimination, le vainqueur entre dans le tour suivant ; une égalité laisse le
 * match à rejouer.
 */
export function recordMatch(t: Tournament, id: string, result: MatchResult): Tournament {
  const target = t.matches.find((m) => m.id === id);
  if (!target || target.a === null || target.b === null) return t;
  if (t.kind === 'poule') {
    return { ...t, matches: t.matches.map((m) => (m.id === id ? { ...m, result, winner: winnerId(m, result) } : m)) };
  }

  const winner = result.winner === null ? null : winnerId(target, result);
  let matches = t.matches.map((m) => (m.id === id ? { ...m, result, winner } : m));
  if (winner !== null) {
    matches = matches.map((m) => {
      if (m.round !== target.round + 1 || m.index !== target.index >> 1) return m;
      return target.index % 2 === 0 ? { ...m, a: winner } : { ...m, b: winner };
    });
  }
  return { ...t, matches };
}

/** Identifiant du vainqueur d’un match, à partir de son résultat. */
function winnerId(m: Match, result: MatchResult): string | null {
  if (result.winner === null) return null;
  return result.winner === 0 ? m.a : m.b;
}

/** Vrai quand la poule est jouée en entier, ou quand le tableau a un champion. */
export function isFinished(t: Tournament): boolean {
  if (t.kind === 'poule') return t.matches.every((m) => m.result !== null);
  const final = finalMatch(t);
  return final?.winner !== null && final?.winner !== undefined;
}

function finalMatch(t: Tournament): Match | undefined {
  const rounds = roundCount(t);
  return t.matches.find((m) => m.round === rounds - 1);
}

function roundCount(t: Tournament): number {
  return t.matches.reduce((max, m) => Math.max(max, m.round + 1), 0);
}

/** Tous les résultats joués, pour le classement. */
function results(t: Tournament): MatchResult[] {
  return t.matches.map((m) => m.result).filter((r): r is MatchResult => r !== null);
}

/**
 * Classement de la poule : points de championnat, puis manches, puis jeux (ou touches). Deux joueurs à égalité
 * partagent le même rang, comme au tennis.
 */
export function standings(ids: readonly string[], matchResults: readonly MatchResult[]): Standing[] {
  const rows = new Map<string, Standing>(
    ids.map((id) => [
      id,
      { id, rank: 0, played: 0, won: 0, drawn: 0, lost: 0, points: 0, wins: [0, 0], scored: [0, 0] },
    ]),
  );
  for (const r of matchResults) {
    const ra = rows.get(r.a);
    const rb = rows.get(r.b);
    if (!ra || !rb) continue;
    ra.played += 1;
    rb.played += 1;
    ra.wins = [ra.wins[0] + r.wins[0], ra.wins[1] + r.wins[1]];
    rb.wins = [rb.wins[0] + r.wins[1], rb.wins[1] + r.wins[0]];
    ra.scored = [ra.scored[0] + r.scored[0], ra.scored[1] + r.scored[1]];
    rb.scored = [rb.scored[0] + r.scored[1], rb.scored[1] + r.scored[0]];
    if (r.winner === null) {
      ra.drawn += 1;
      rb.drawn += 1;
      ra.points += 1;
      rb.points += 1;
    } else if (r.winner === 0) {
      ra.won += 1;
      ra.points += 3;
      rb.lost += 1;
    } else {
      rb.won += 1;
      rb.points += 3;
      ra.lost += 1;
    }
  }

  const order = (x: Standing, y: Standing): number =>
    y.points - x.points ||
    y.wins[0] - y.wins[1] - (x.wins[0] - x.wins[1]) ||
    y.scored[0] - y.scored[1] - (x.scored[0] - x.scored[1]);
  const sorted = [...rows.values()].sort((x, y) => order(x, y) || ids.indexOf(x.id) - ids.indexOf(y.id));
  let rank = 0;
  let previous: Standing | null = null;
  sorted.forEach((row, i) => {
    if (!previous || order(previous, row) !== 0) rank = i + 1;
    row.rank = rank;
    previous = row;
  });
  return sorted;
}

/** Classement final du tournoi : pour la poule, le tableau de la poule ; pour l’élimination, le tour d’élimination. */
export function placings(t: Tournament): { id: string; rank: number }[] {
  if (t.kind === 'poule') {
    return standings(t.ids, results(t)).map((s) => ({ id: s.id, rank: s.rank }));
  }
  const rounds = roundCount(t);
  // Tour où chaque joueur est éliminé : le champion est éliminé « après » la finale.
  const lostIn = new Map<string, number>();
  for (const m of t.matches) {
    if (m.winner === null || m.a === null || m.b === null) continue;
    const loser = m.winner === m.a ? m.b : m.a;
    if (!lostIn.has(loser)) lostIn.set(loser, m.round);
  }
  const champion = finalMatch(t)?.winner ?? null;
  if (champion !== null) lostIn.set(champion, rounds);
  const depth = (id: string): number => lostIn.get(id) ?? -1;
  return t.ids
    .map((id) => ({ id, rank: 1 + t.ids.filter((o) => depth(o) > depth(id)).length }))
    .sort((x, y) => x.rank - y.rank || t.ids.indexOf(x.id) - t.ids.indexOf(y.id));
}

/** Champion d’un tableau terminé. */
export function championOf(t: Tournament): string | null {
  if (t.kind !== 'eliminatoire') return null;
  return finalMatch(t)?.winner ?? null;
}
