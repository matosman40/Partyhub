import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { addPoints, directory, fail, ok, rankEntries } from '../common/engine.js';
import { SIDES } from './rules.js';
import { gamesLabel, pointLabels, isDeuce, type BestOf, type Who } from './score.js';
import { expire, hitBy, lostBall, newDuel, resultOf, type Duel } from './match.js';
import {
  championOf,
  createTournament,
  isFinished,
  nextMatch,
  placings,
  recordMatch,
  standings,
  type Match,
  type MatchResult,
  type Tournament,
  type TournamentKind,
} from './tournament.js';

/**
 * Tennis party : chaque joueur défend un côté du terrain, avec sa raquette pilotée par l’inclinaison de son téléphone.
 * L’écran principal fait jouer la balle (voir `rules.ts`) et signale chaque coup réussi et chaque balle perdue.
 *
 * Trois formes de jeu, choisies dans les réglages :
 * - partie libre, règles simples : tous les joueurs à la fois, avec des vies (comme avant) ;
 * - poule ou tableau : les joueurs s’affrontent deux par deux, à tour de rôle, avec des matchs aux règles simples
 *   (des vies) ou aux règles du vrai tennis (points, jeux, sets) ;
 * - partie libre, règles du tennis : un seul match entre deux joueurs.
 *
 * Le serveur tient le score, les vies et les matchs, et ne croit une balle perdue ou un coup que s’il vise un côté
 * occupé par un joueur encore en jeu.
 */

export const tennisSettingsSchema = z.object({
  /** Vies de chaque joueur (règles simples) : une balle perdue en coûte une. */
  lives: z.number().int().min(1).max(5).default(3),
  /** Règles simples (des vies), ou règles du vrai tennis (points, jeux, sets, tie-break). */
  rules: z.enum(['vies', 'tennis']).default('vies'),
  /** Partie libre, poule (tous contre tous) ou tableau à élimination directe. */
  format: z.enum(['libre', 'poule', 'eliminatoire']).default('libre'),
  /** Règles du tennis : un set, ou le meilleur de trois sets. */
  sets: z.enum(['1', '3']).default('1'),
});

export type TennisSettings = z.infer<typeof tennisSettingsSchema>;

/** Points de la partie libre : un coup réussi, une vie restante en fin de partie, la prime du dernier debout. */
export const HIT_POINTS = 10;
const LIFE_POINTS = 5;
const SURVIVOR_POINTS = 50;
/** Durée maximale d’un match aux règles simples, et d’un match aux règles du tennis. */
export const MATCH_MS = 150_000;
export const TENNIS_MATCH_MS = 600_000;
/** Pause entre deux matchs d’un championnat : le temps de lire le tableau. */
export const PAUSE_MS = 8_000;
/** Points du classement final, par rang : même barème que le championnat par équipes. */
export const PLACE_POINTS = [10, 6, 4, 3, 2, 1];
const MATCH_END = 'match-end';
const NEXT_MATCH = 'next-match';
/** Écart minimal entre deux coups comptés sur un même côté : évite qu’un rebond compte deux fois. */
const HIT_GAP_MS = 60;

export type TennisPhase = 'ready' | 'play' | 'pause' | 'final';

export interface TennisState {
  phase: TennisPhase;
  settings: TennisSettings;
  players: Record<string, string>;
  /** Points de chaque joueur : ceux de la partie libre, puis ceux du classement final. */
  points: Record<string, number>;
  /** Joueur de chaque côté (bas, haut, gauche, droite), ou null. Un match n’occupe que le bas et le haut. */
  seats: (string | null)[];
  /** Vies de chaque joueur, en partie libre. */
  lives: Record<string, number>;
  /** Ordre d’élimination, en partie libre. */
  eliminated: string[];
  /** Instant du dernier coup compté, par côté. */
  lastHitAt: number[];
  /** Fin prévue de la phase en cours : fin du match, ou fin de la pause entre deux matchs. */
  endsAt: number;
  /** Championnat (poule ou tableau) ; null en partie libre. */
  tournament: Tournament | null;
  /** Match en cours, et son état. */
  match: { id: string; duel: Duel } | null;
}

const sideSchema = z.object({ side: z.number().int().min(0).max(3) });

function isAlive(s: TennisState, id: string | null): boolean {
  return id !== null && (s.lives[id] ?? 0) > 0;
}

function aliveIds(s: TennisState): string[] {
  return s.seats.filter((id): id is string => isAlive(s, id));
}

/** Forme du championnat : null en partie libre aux règles simples, sinon la forme choisie. */
function tournamentKind(settings: TennisSettings): TournamentKind | null {
  if (settings.format === 'libre') return settings.rules === 'tennis' ? 'poule' : null;
  return settings.format;
}

function bestOf(settings: TennisSettings): BestOf {
  return settings.sets === '3' ? 3 : 1;
}

function matchLimit(settings: TennisSettings): number {
  return settings.rules === 'tennis' ? TENNIS_MATCH_MS : MATCH_MS;
}

/** Résultats joués, pour le classement de la poule. */
function resultsOf(t: Tournament): MatchResult[] {
  return t.matches.flatMap((m) => (m.result ? [m.result] : []));
}

function roundCount(t: Tournament): number {
  return t.matches.reduce((max, m) => Math.max(max, m.round + 1), 0);
}

/** Libellé d’un match : « Manche 3 » en poule, « Demi-finale » ou « Finale » au tableau. */
function matchLabel(t: Tournament, m: Match): string {
  if (t.kind === 'poule') return `Manche ${m.round + 1}`;
  const back = roundCount(t) - 1 - m.round;
  if (back === 0) return 'Finale';
  if (back === 1) return 'Demi-finale';
  if (back === 2) return 'Quart de finale';
  return `Tour ${m.round + 1}`;
}

/** Clôt la partie. En partie libre : bonus de vies restantes, prime pour le dernier debout. En championnat : rangs. */
function finish(s: TennisState, ctx: GameContext): TennisState {
  ctx.cancel(MATCH_END);
  ctx.cancel(NEXT_MATCH);
  if (s.tournament) {
    const points: Record<string, number> = Object.fromEntries(Object.keys(s.players).map((id) => [id, 0]));
    for (const { id, rank } of placings(s.tournament)) points[id] = PLACE_POINTS[rank - 1] ?? 0;
    return { ...s, phase: 'final', points, endsAt: 0, match: null, seats: SIDES.map(() => null) };
  }
  const survivors = aliveIds(s);
  let points = s.points;
  for (const id of survivors) points = addPoints(points, id, (s.lives[id] ?? 0) * LIFE_POINTS);
  if (survivors.length === 1 && survivors[0]) points = addPoints(points, survivors[0], SURVIVOR_POINTS);
  return { ...s, phase: 'final', points, endsAt: 0 };
}

/** Lance le prochain match du championnat, ou termine la partie s’il n’en reste pas. */
function beginMatch(s: TennisState, ctx: GameContext): TennisState {
  const next = s.tournament ? nextMatch(s.tournament) : null;
  if (!next || next.a === null || next.b === null) return finish(s, ctx);
  const limit = matchLimit(s.settings);
  // Le service part au hasard pour le premier point d’un match aux règles du tennis.
  const first: Who = ctx.random() < 0.5 ? 0 : 1;
  ctx.cancel(NEXT_MATCH);
  ctx.schedule(MATCH_END, limit);
  return {
    ...s,
    phase: 'play',
    seats: [next.a, next.b, null, null],
    match: { id: next.id, duel: newDuel(s.settings.rules, s.settings.lives, bestOf(s.settings), first) },
    endsAt: ctx.now() + limit,
  };
}

/** Le match en cours est fini : son résultat va au championnat, puis une pause ou la fin de la partie. */
function endMatch(s: TennisState, ctx: GameContext): TennisState {
  const current = s.match;
  if (!current || !s.tournament) return s;
  const record = s.tournament.matches.find((m) => m.id === current.id);
  if (!record || record.a === null || record.b === null) return s;
  ctx.cancel(MATCH_END);
  const tournament = recordMatch(s.tournament, current.id, resultOf(current.duel, record.a, record.b));
  const cleared: TennisState = { ...s, tournament, match: null, seats: SIDES.map(() => null) };
  if (isFinished(tournament)) return finish(cleared, ctx);
  ctx.schedule(NEXT_MATCH, PAUSE_MS);
  return { ...cleared, phase: 'pause', endsAt: ctx.now() + PAUSE_MS };
}

/** Événement d’un match : seuls le bas et le haut jouent, et leurs coups ou balles perdues comptent. */
function matchEvent(s: TennisState, type: 'hit' | 'lost', side: number, ctx: GameContext): TennisState {
  const current = s.match;
  if (!current || (side !== 0 && side !== 1) || !s.seats[side]) return s;
  const who: Who = side === 1 ? 1 : 0;
  if (type === 'hit') {
    const now = ctx.now();
    if (now - (s.lastHitAt[side] ?? 0) < HIT_GAP_MS) return s;
    const lastHitAt = s.lastHitAt.map((t, i) => (i === side ? now : t));
    return { ...s, lastHitAt, match: { ...current, duel: hitBy(current.duel, who) } };
  }
  const next: TennisState = { ...s, match: { ...current, duel: lostBall(current.duel, who) } };
  return next.match?.duel.done ? endMatch(next, ctx) : next;
}

/** Événement de la partie libre : un coup rapporte des points, une balle perdue coûte une vie. */
function freeEvent(s: TennisState, type: 'hit' | 'lost', side: number, ctx: GameContext): TennisState {
  const id = s.seats[side] ?? null;
  if (!isAlive(s, id) || id === null) return s;

  if (type === 'hit') {
    const now = ctx.now();
    if (now - (s.lastHitAt[side] ?? 0) < HIT_GAP_MS) return s;
    const lastHitAt = s.lastHitAt.map((t, i) => (i === side ? now : t));
    return { ...s, points: addPoints(s.points, id, HIT_POINTS), lastHitAt };
  }

  const remaining = (s.lives[id] ?? 0) - 1;
  const lives = { ...s.lives, [id]: remaining };
  const next: TennisState = {
    ...s,
    lives,
    eliminated: remaining === 0 ? [...s.eliminated, id] : s.eliminated,
  };
  return aliveIds(next).length <= 1 ? finish(next, ctx) : next;
}

/** Rang d’un joueur à la fin de la partie (placement du championnat, ou classement de la partie libre). */
function finalRank(s: TennisState, playerId: string): number | null {
  if (s.phase !== 'final') return null;
  if (s.tournament) return placings(s.tournament).find((p) => p.id === playerId)?.rank ?? null;
  return rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
}

/** Classement affiché pendant la partie : celui de la poule, sinon les points de la partie libre. */
function rankingOf(s: TennisState): ScoreEntry[] {
  const t = s.tournament;
  if (!t || s.phase === 'final' || t.kind !== 'poule') return rankEntries(s.players, s.points);
  return standings(t.ids, resultsOf(t)).map((r) => ({
    playerId: r.id,
    name: s.players[r.id] ?? '?',
    points: r.points,
    rank: r.rank,
  }));
}

export interface TennisMatchBase {
  id: string;
  label: string;
  /** Joueur du bas, puis joueur du haut. */
  names: [string, string];
  hits: [number, number];
}

/** Match en cours, pour les écrans. Les champs des règles du tennis et ceux des règles simples ne se mélangent pas. */
export type TennisMatchView =
  | (TennisMatchBase & {
      rules: 'tennis';
      /** Points du jeu en cours, par joueur (« 15 », « Avantage »…). */
      points: [string, string];
      /** Jeux de chaque set joué, par exemple « 6-4 3-2 ». */
      games: string;
      sets: [number, number];
      /** Joueur qui sert : 0 pour le bas, 1 pour le haut. */
      server: Who;
      deuce: boolean;
      tiebreak: boolean;
    })
  | (TennisMatchBase & { rules: 'vies'; lives: [number, number] });

function matchView(s: TennisState): TennisMatchView | null {
  const current = s.match;
  const t = s.tournament;
  if (!current || !t) return null;
  const record = t.matches.find((m) => m.id === current.id);
  const nameOf = (id: string | null): string => (id ? (s.players[id] ?? '?') : '?');
  const base = {
    id: current.id,
    label: record ? matchLabel(t, record) : '',
    names: [nameOf(s.seats[0] ?? null), nameOf(s.seats[1] ?? null)] as [string, string],
    hits: current.duel.hits,
  };
  const d = current.duel;
  if (d.rules === 'tennis') {
    return {
      ...base,
      rules: 'tennis',
      points: pointLabels(d.score),
      games: gamesLabel(d.score),
      sets: [d.score.setsWon[0], d.score.setsWon[1]],
      server: d.score.server,
      deuce: isDeuce(d.score),
      tiebreak: d.score.tiebreak,
    };
  }
  return { ...base, rules: 'vies', lives: [d.lives[0], d.lives[1]] };
}

export interface TournamentRow {
  id: string;
  label: string;
  a: string | null;
  b: string | null;
  winner: string | null;
  bye: boolean;
  result: MatchResult | null;
  status: 'played' | 'playing' | 'waiting' | 'bye';
}

export interface TournamentView {
  kind: TournamentKind;
  matches: TournamentRow[];
  /** Tableau de la poule, avec les points de championnat ; null au tableau à élimination. */
  standings: (ReturnType<typeof standings>[number] & { name: string })[] | null;
  champion: string | null;
  done: boolean;
}

function tournamentView(s: TennisState): TournamentView | null {
  const t = s.tournament;
  if (!t) return null;
  const nameOf = (id: string | null): string | null => (id ? (s.players[id] ?? '?') : null);
  const playing = s.match?.id ?? null;
  const matches: TournamentRow[] = t.matches.map((m) => {
    let status: TournamentRow['status'] = 'waiting';
    if (m.bye) status = 'bye';
    else if (m.id === playing) status = 'playing';
    else if (t.kind === 'poule' ? m.result !== null : m.winner !== null) status = 'played';
    return {
      id: m.id,
      label: matchLabel(t, m),
      a: nameOf(m.a),
      b: nameOf(m.b),
      winner: nameOf(m.winner),
      bye: m.bye,
      result: m.result,
      status,
    };
  });
  const table =
    t.kind === 'poule' ? standings(t.ids, resultsOf(t)).map((row) => ({ ...row, name: nameOf(row.id) ?? '?' })) : null;
  return {
    kind: t.kind,
    matches,
    standings: table,
    champion: nameOf(championOf(t)),
    done: isFinished(t),
  };
}

export const tennisParty: GameModule<TennisState, TennisSettings> = {
  manifest: {
    id: 'tennis-party',
    category: 'plateau',
    name: 'Tennis party',
    description:
      'Défendez votre côté du court : penchez le téléphone pour renvoyer la balle, en match ou en championnat.',
    icon: '🎾',
    version: '1.1.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    durationMin: 3,
    notice: {
      goal: 'Renvoyer la balle le plus souvent possible, ou remporter le match, la poule ou le tableau.',
      steps: [
        'Chaque joueur défend un côté du court, sur l’écran principal. En match, deux joueurs se font face, bas contre haut.',
        'Penchez le téléphone pour glisser votre raquette le long de votre côté. Les boutons de l’écran font la même chose.',
        'Partie libre : renvoyez la balle, et gardez vos vies. Championnat : chaque match se joue à deux, à tour de rôle.',
        'Règles du tennis : 15, 30, 40, jeux, sets et tie-break. Le joueur qui gagne la poule ou le tableau est couronné.',
      ],
      tips: [
        'L’inclinaison demande HTTPS sur le réseau local (voir la page « Test des appareils »).',
        'Tenez le téléphone comme au départ : « Recentrer » reprend cette pose. Sans capteur, les boutons suffisent.',
        'Un joueur sans téléphone, ou un robot, est joué par l’écran principal.',
      ],
    },
  },

  settingsSchema: tennisSettingsSchema,
  defaultSettings: tennisSettingsSchema.parse({}),

  // Les joueurs ne déclenchent aucune action : leur raquette passe par le relais des capteurs.
  actions: {},

  initialize(settings, players) {
    const parsed = tennisSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      seats: SIDES.map(() => null),
      lives: {},
      eliminated: [],
      lastHitAt: SIDES.map(() => 0),
      endsAt: 0,
      tournament: null,
      match: null,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      players: { ...s.players, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const points = { ...s.points };
    delete players[p.id];
    delete points[p.id];
    return { ...s, players, points };
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    const ids = Object.keys(s.players);
    if (ids.length < 2) return fail('Il faut au moins deux joueurs');

    const kind = tournamentKind(s.settings);
    if (kind === null) {
      // Partie libre aux règles simples : les premiers joueurs prennent les côtés, tous jouent en même temps.
      const seats: (string | null)[] = SIDES.map((_, i) => ids[i] ?? null);
      const lives = Object.fromEntries(ids.map((id) => [id, s.settings.lives]));
      ctx.schedule(MATCH_END, MATCH_MS);
      return ok({ ...s, phase: 'play', seats, lives, endsAt: ctx.now() + MATCH_MS });
    }

    if (s.settings.format === 'libre' && ids.length !== 2) {
      return fail('Les règles du tennis se jouent à deux : choisissez une poule ou un tableau pour plus de joueurs');
    }
    const tournament = createTournament(kind, ids);
    return ok(beginMatch({ ...s, tournament, match: null }, ctx));
  },

  handleAction(_s, _p, type) {
    return fail(`Action inconnue : ${type}`);
  },

  hostActions: {
    hit: sideSchema,
    lost: sideSchema,
  },

  handleHostAction(s, type, payload, ctx) {
    if (type !== 'hit' && type !== 'lost') return fail('Action inconnue');
    const parsed = sideSchema.safeParse(payload);
    if (!parsed.success) return fail('Côté invalide');
    // Un événement arrivé hors de la phase de jeu, ou pour un côté libre ou éliminé, ne change rien.
    if (s.phase !== 'play') return ok(s);
    if (s.tournament) return ok(matchEvent(s, type, parsed.data.side, ctx));
    return ok(freeEvent(s, type, parsed.data.side, ctx));
  },

  onTimer(s, key, ctx) {
    if (key === MATCH_END && s.phase === 'play') {
      if (s.tournament && s.match) {
        return endMatch({ ...s, match: { ...s.match, duel: expire(s.match.duel) } }, ctx);
      }
      return finish(s, ctx);
    }
    if (key === NEXT_MATCH && s.phase === 'pause') return beginMatch(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    return s.phase === 'play' || s.phase === 'pause' ? finish(s, ctx) : s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return s.phase === 'final' ? s : finish(s, ctx);
  },

  getPublicState(s) {
    return {
      phase: s.phase,
      rules: s.settings.rules,
      format: s.settings.format,
      lives: s.settings.lives,
      sets: bestOf(s.settings),
      matchMs: matchLimit(s.settings),
      endsAt: s.endsAt,
      seats: SIDES.map((side) => {
        const id = s.seats[side] ?? null;
        if (s.tournament) {
          const d = s.match?.duel;
          return {
            side,
            playerId: id,
            name: id ? (s.players[id] ?? '?') : null,
            lives: d?.rules === 'vies' && (side === 0 || side === 1) ? d.lives[side] : 0,
            points: id ? (s.points[id] ?? 0) : 0,
            alive: id !== null && d !== undefined && !d.done,
          };
        }
        return {
          side,
          playerId: id,
          name: id ? (s.players[id] ?? '?') : null,
          lives: id ? (s.lives[id] ?? 0) : 0,
          points: id ? (s.points[id] ?? 0) : 0,
          alive: isAlive(s, id),
        };
      }),
      ranking: rankingOf(s),
      match: matchView(s),
      tournament: tournamentView(s),
    };
  },

  getPlayerState(s, playerId) {
    if (s.tournament) {
      const side = s.seats.indexOf(playerId);
      const d = s.match?.duel;
      const playing = side >= 0 && side <= 1 && d !== undefined && !d.done;
      const label = playing && d?.rules === 'tennis' ? pointLabels(d.score)[side === 1 ? 1 : 0] : '';
      return {
        side: playing ? side : null,
        alive: playing,
        waiting: !playing && (s.phase === 'play' || s.phase === 'pause'),
        lives: playing && d?.rules === 'vies' ? (d.lives[side] ?? 0) : 0,
        points: s.points[playerId] ?? 0,
        rank: finalRank(s, playerId),
        label,
      };
    }
    const index = s.seats.indexOf(playerId);
    return {
      side: index >= 0 ? index : null,
      alive: isAlive(s, playerId),
      waiting: false,
      lives: s.lives[playerId] ?? 0,
      points: s.points[playerId] ?? 0,
      rank: finalRank(s, playerId),
      label: '',
    };
  },

  getHostState() {
    return {};
  },

  isFinished(s) {
    return s.phase === 'final';
  },
};
