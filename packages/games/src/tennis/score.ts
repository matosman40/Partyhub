/**
 * Score du tennis réel : points d’un jeu, jeux d’un set, sets d’un match.
 *
 * Règles suivies : 0, 15, 30, 40, puis avantage et égalité (deuce) ; un set se gagne à 6 jeux avec deux jeux d’écart,
 * et à 6 jeux partout on joue un tie-break jusqu’à 7 points avec deux d’écart. Le service change à chaque jeu, et
 * dans le tie-break il change après le premier point, puis tous les deux points. Le set suivant commence par le joueur
 * qui n’a pas servi en premier le tie-break.
 *
 * Fichier pur : ni DOM, ni réseau. Les joueurs sont identifiés par leur indice dans le match (0 ou 1).
 */

export type Who = 0 | 1;
/** Un set (le match se joue en un set) ou le meilleur de trois sets. */
export type BestOf = 1 | 3;

const GAMES_TO_WIN = 6;
const TIEBREAK_TO = 7;
const POINT_LABELS = ['0', '15', '30', '40'] as const;

export interface TennisScore {
  bestOf: BestOf;
  /** Jeux de chaque set joué, le dernier étant le set en cours : [jeux du joueur 0, jeux du joueur 1]. */
  games: [number, number][];
  /** Sets remportés par chaque joueur. */
  setsWon: [number, number];
  /** Points du jeu en cours, ou du tie-break. */
  points: [number, number];
  /** Le set en cours est un tie-break. */
  tiebreak: boolean;
  /** Joueur qui sert le point en cours. */
  server: Who;
  /** Joueur qui a servi le premier point du tie-break en cours. */
  tiebreakFirst: Who;
  /** Vainqueur du match, une fois celui-ci terminé. */
  winner: Who | null;
}

export const other = (who: Who): Who => (who === 0 ? 1 : 0);

/** Score vierge : le joueur `first` sert le premier jeu. */
export function newScore(bestOf: BestOf = 1, first: Who = 0): TennisScore {
  return {
    bestOf,
    games: [[0, 0]],
    setsWon: [0, 0],
    points: [0, 0],
    tiebreak: false,
    server: first,
    tiebreakFirst: first,
    winner: null,
  };
}

/** Joueur qui sert le point numéro `played` (0 pour le premier) d’un tie-break : un service, puis deux chacun. */
export function tiebreakServer(first: Who, played: number): Who {
  const block = Math.floor((played + 1) / 2) % 2;
  return block === 0 ? first : other(first);
}

/** Vrai quand `a` atteint `to` avec deux points (ou jeux) d’avance sur `b`. */
function leadsBy2(a: number, b: number, to: number): boolean {
  return a >= to && a - b >= 2;
}

/** Copie des jeux, avec un jeu de plus pour `who` dans le set en cours. */
function addGame(games: [number, number][], who: Who): [number, number][] {
  const copy = games.map((g) => [g[0], g[1]] as [number, number]);
  const current = copy[copy.length - 1] ?? [0, 0];
  current[who] += 1;
  copy[copy.length - 1] = current;
  return copy;
}

/** Ferme le set en cours, puis le match si ce set était le dernier nécessaire. `nextServer` sert le set suivant. */
function closeSet(s: TennisScore, who: Who, games: [number, number][], nextServer: Who): TennisScore {
  const setsWon: [number, number] = [s.setsWon[0], s.setsWon[1]];
  setsWon[who] += 1;
  const needed = s.bestOf === 1 ? 1 : 2;
  if (setsWon[who] >= needed) {
    return { ...s, games, setsWon, points: [0, 0], tiebreak: false, winner: who };
  }
  return {
    ...s,
    games: [...games, [0, 0]],
    setsWon,
    points: [0, 0],
    tiebreak: false,
    server: nextServer,
    tiebreakFirst: nextServer,
  };
}

/** Un jeu vient d’être gagné par `who` : on passe au jeu suivant, au set suivant, ou au tie-break. */
function winGame(s: TennisScore, who: Who): TennisScore {
  const games = addGame(s.games, who);
  const current = games[games.length - 1] ?? [0, 0];
  const nextServer = other(s.server);
  if (leadsBy2(current[who], current[other(who)], GAMES_TO_WIN)) {
    return closeSet(s, who, games, nextServer);
  }
  if (current[0] === GAMES_TO_WIN && current[1] === GAMES_TO_WIN) {
    // Tie-break : le joueur qui sert le jeu suivant sert aussi le premier point.
    return { ...s, games, points: [0, 0], tiebreak: true, server: nextServer, tiebreakFirst: nextServer };
  }
  return { ...s, games, points: [0, 0], server: nextServer };
}

/**
 * Ajoute un point au joueur `who`, et fait avancer le jeu, le set et le match. Sans effet quand le match est fini.
 */
export function addPoint(s: TennisScore, who: Who): TennisScore {
  if (s.winner !== null) return s;
  const points: [number, number] = [s.points[0], s.points[1]];
  points[who] += 1;
  const [a, b] = points;

  if (s.tiebreak) {
    if (leadsBy2(points[who], points[other(who)], TIEBREAK_TO)) {
      // Le tie-break gagné fait 7 jeux au vainqueur, 6 à l’autre ; le set suivant est servi par l’autre joueur.
      return closeSet(s, who, addGame(s.games, who), other(s.tiebreakFirst));
    }
    return { ...s, points, server: tiebreakServer(s.tiebreakFirst, a + b) };
  }

  if (leadsBy2(points[who], points[other(who)], 4)) return winGame(s, who);
  return { ...s, points };
}

/** Libellés des points du jeu en cours : « 15 », « 40 », « Avantage », ou les points bruts dans un tie-break. */
export function pointLabels(s: TennisScore): [string, string] {
  const [a, b] = s.points;
  if (s.tiebreak) return [String(a), String(b)];
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['Avantage', '40'] : ['40', 'Avantage'];
  }
  return [POINT_LABELS[Math.min(a, 3)] ?? '40', POINT_LABELS[Math.min(b, 3)] ?? '40'];
}

/** Vrai à égalité 40 partout, quand le prochain point décide : on dit « égalité ». */
export function isDeuce(s: TennisScore): boolean {
  return !s.tiebreak && s.points[0] >= 3 && s.points[0] === s.points[1];
}

/** Total des jeux gagnés par un joueur, tous sets confondus. */
export function gamesWon(s: TennisScore, who: Who): number {
  return s.games.reduce((total, g) => total + g[who], 0);
}

/** Les jeux de chaque set, par exemple « 6-4 3-2 ». */
export function gamesLabel(s: TennisScore): string {
  return s.games.map((g) => `${g[0]}-${g[1]}`).join(' ');
}

/**
 * Joueur en tête quand le temps est écoulé : sets gagnés, puis jeux, puis points du jeu en cours. Null en cas
 * d’égalité parfaite.
 */
export function leaderOf(s: TennisScore): Who | null {
  const diffs = [s.setsWon[0] - s.setsWon[1], gamesWon(s, 0) - gamesWon(s, 1), s.points[0] - s.points[1]];
  for (const diff of diffs) {
    if (diff > 0) return 0;
    if (diff < 0) return 1;
  }
  return null;
}
