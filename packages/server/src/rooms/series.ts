import type {
  ScoreEntry,
  SeriesBadgeView,
  SeriesHistoryView,
  SeriesStandingView,
  SeriesTeamView,
  SeriesTierView,
  SeriesView,
} from '@partyhub/shared';

/**
 * Championnat d’un salon : une série de manches (le même jeu ou des jeux successifs), des points selon le rang,
 * des équipes équilibrées, des rangs de progression et des icônes de victoire. Le module ne connaît ni la salle ni
 * les sockets : il reçoit le classement de chaque partie et calcule la vue affichée.
 */

/** Points du championnat selon le rang en compétition : 10 au premier, puis 6, 4, 3, 2, 1. Au-delà : 1 point. */
export const PLACE_POINTS = [10, 6, 4, 3, 2, 1] as const;
export const SERIES_LENGTH_MIN = 1;
export const SERIES_LENGTH_MAX = 10;
export const TEAM_COUNT_OPTIONS = [0, 2, 3, 4] as const;

/** Rangs de progression, du plus bas au plus haut. `min` : points de championnat nécessaires. */
export const SERIES_TIERS = [
  { id: 'recrue', label: 'Recrue', icon: '🌱', min: 0 },
  { id: 'habitue', label: 'Habitué', icon: '🎯', min: 10 },
  { id: 'confirme', label: 'Confirmé', icon: '⭐', min: 25 },
  { id: 'expert', label: 'Expert', icon: '💎', min: 50 },
  { id: 'legende', label: 'Légende', icon: '👑', min: 100 },
] as const;

export const TEAM_PALETTE = [
  { name: 'Rouge', icon: '🔴', color: '#ff5f6d' },
  { name: 'Bleue', icon: '🔵', color: '#4cc9f0' },
  { name: 'Verte', icon: '🟢', color: '#7bd389' },
  { name: 'Jaune', icon: '🟡', color: '#ffd166' },
] as const;

export interface PlayerTally {
  name: string;
  points: number;
  played: number;
  wins: number;
  podiums: number;
  /** Victoires d’affilée en cours, et la plus longue série. */
  streak: number;
  bestStreak: number;
}

export interface SeriesGame {
  game: string;
  winners: string[];
}

/** État mutable du championnat, tenu par la salle. */
export interface SeriesRecord {
  length: number;
  teamCount: number;
  games: SeriesGame[];
  tallies: Record<string, PlayerTally>;
  /** Équipe de chaque joueur (indice). Vide sans équipes. */
  teams: Record<string, number>;
}

export function pointsForRank(rank: number): number {
  if (rank < 1) return 0;
  return PLACE_POINTS[rank - 1] ?? 1;
}

export function tierFor(points: number): SeriesTierView {
  let tier: (typeof SERIES_TIERS)[number] = SERIES_TIERS[0];
  for (const candidate of SERIES_TIERS) {
    if (points >= candidate.min) tier = candidate;
  }
  return { id: tier.id, label: tier.label, icon: tier.icon };
}

export function createSeries(length: number, teamCount: number): SeriesRecord {
  return { length, teamCount, games: [], tallies: {}, teams: {} };
}

export function seriesFinished(series: SeriesRecord): boolean {
  return series.games.length >= series.length;
}

/**
 * Répartit les joueurs en équipes équilibrées. Une équipe déjà attribuée est gardée tant qu’elle existe, pour qu’un
 * joueur reste dans la même équipe d’une manche à l’autre ; les nouveaux vont dans l’équipe la moins fournie.
 */
export function assignTeams(
  playerIds: string[],
  count: number,
  previous: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (count < 2) return out;
  const sizes = Array.from({ length: count }, () => 0);
  for (const id of playerIds) {
    const team = previous[id];
    if (team !== undefined && team < count) {
      out[id] = team;
      sizes[team]! += 1;
    }
  }
  for (const id of playerIds) {
    if (id in out) continue;
    let best = 0;
    for (let i = 1; i < count; i++) {
      if (sizes[i]! < sizes[best]!) best = i;
    }
    out[id] = best;
    sizes[best]! += 1;
  }
  return out;
}

/** Enregistre le classement d’une partie terminée dans le championnat. */
export function recordGame(series: SeriesRecord, game: string, ranking: ScoreEntry[]): void {
  for (const entry of ranking) {
    const tally = series.tallies[entry.playerId] ?? {
      name: entry.name,
      points: 0,
      played: 0,
      wins: 0,
      podiums: 0,
      streak: 0,
      bestStreak: 0,
    };
    tally.name = entry.name;
    tally.points += pointsForRank(entry.rank);
    tally.played += 1;
    if (entry.rank === 1) {
      tally.wins += 1;
      tally.streak += 1;
      tally.bestStreak = Math.max(tally.bestStreak, tally.streak);
    } else {
      tally.streak = 0;
    }
    if (entry.rank <= 3) tally.podiums += 1;
    series.tallies[entry.playerId] = tally;
  }
  const winners = ranking.filter((e) => e.rank === 1).map((e) => e.name);
  series.games.push({ game, winners });
}

/** Rang en compétition : deux ex æquo partagent le même rang, le suivant saute. */
function competitionRank<T>(items: T[], points: (item: T) => number): number[] {
  return items.map((item) => 1 + items.filter((other) => points(other) > points(item)).length);
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'fr');
}

function badgesFor(tally: PlayerTally, isChampion: boolean): SeriesBadgeView[] {
  const badges: SeriesBadgeView[] = [];
  if (isChampion) badges.push({ id: 'champion', icon: '🏆', label: 'Champion' });
  if (tally.bestStreak >= 2) {
    badges.push({ id: 'serie', icon: '🔥', label: `Série de ${tally.bestStreak} victoires` });
  }
  if (tally.played >= 2 && tally.wins === tally.played) {
    badges.push({ id: 'invaincu', icon: '👑', label: 'Invaincu' });
  }
  if (tally.played >= 2 && tally.podiums === tally.played) {
    badges.push({ id: 'regulier', icon: '🎯', label: 'Régulier : toujours sur le podium' });
  }
  return badges;
}

/** Vue du championnat : classements, équipes, historique et vainqueur quand il est terminé. */
export function seriesView(series: SeriesRecord): SeriesView {
  const finished = seriesFinished(series);
  const hasTeams = series.teamCount >= 2;

  const rows = Object.entries(series.tallies).map(([playerId, tally]) => ({ playerId, tally }));
  rows.sort(
    (a, b) =>
      b.tally.points - a.tally.points || b.tally.wins - a.tally.wins || compareNames(a.tally.name, b.tally.name),
  );
  const ranks = competitionRank(rows, (row) => row.tally.points);

  // Équipes : leur total est la somme des points de leurs membres.
  const teamPoints = Array.from({ length: hasTeams ? series.teamCount : 0 }, () => 0);
  for (const { playerId, tally } of rows) {
    const team = series.teams[playerId];
    if (team !== undefined && team < teamPoints.length) teamPoints[team]! += tally.points;
  }
  const teamRanks = competitionRank(teamPoints, (points) => points);
  const teams: SeriesTeamView[] | null = hasTeams
    ? teamPoints.map((points, index) => {
        const palette = TEAM_PALETTE[index] ?? TEAM_PALETTE[0];
        return {
          index,
          name: palette.name,
          icon: palette.icon,
          color: palette.color,
          points,
          rank: teamRanks[index] ?? 1,
          members: rows.filter((row) => series.teams[row.playerId] === index).map((row) => row.tally.name),
        };
      })
    : null;

  const topTeams = teams ? teams.filter((t) => t.rank === 1) : [];
  const championTeams = new Set(topTeams.map((t) => t.index));
  const isChampion = (playerId: string, rank: number): boolean => {
    if (!finished) return false;
    if (teams) return series.teams[playerId] !== undefined && championTeams.has(series.teams[playerId]!);
    return rank === 1;
  };

  const standings: SeriesStandingView[] = rows.map(({ playerId, tally }, i) => ({
    playerId,
    name: tally.name,
    points: tally.points,
    rank: ranks[i] ?? 1,
    wins: tally.wins,
    podiums: tally.podiums,
    played: tally.played,
    tier: tierFor(tally.points),
    badges: badgesFor(tally, isChampion(playerId, ranks[i] ?? 1)),
    team: hasTeams ? (series.teams[playerId] ?? null) : null,
  }));

  let champion: SeriesView['champion'] = null;
  if (finished && standings.length > 0) {
    if (teams) {
      if (topTeams.length > 0) {
        champion =
          topTeams.length === 1
            ? { names: [topTeams[0]!.name], team: topTeams[0]!.index }
            : { names: topTeams.map((t) => t.name), team: null };
      }
    } else {
      const top = standings.filter((s) => s.rank === 1).map((s) => s.name);
      champion = { names: top, team: null };
    }
  }

  const history: SeriesHistoryView[] = series.games.map((g, i) => ({
    index: i + 1,
    game: g.game,
    winners: g.winners,
  }));

  return {
    length: series.length,
    played: series.games.length,
    finished,
    standings,
    teams,
    history,
    champion,
  };
}
