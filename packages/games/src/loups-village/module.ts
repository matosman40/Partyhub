import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { ROLE_INFO, compositionFor, type Role, type Team } from './roles.js';

/**
 * Les Loups du village : chaque joueur reçoit un rôle en secret. La nuit, les loups
 * dévorent un villageois, la voyante inspecte un joueur, la gardienne en protège un.
 * Le jour, le village débat puis vote pour éliminer un suspect. Les loups gagnent
 * quand ils sont aussi nombreux que les autres ; le village gagne quand ils sont tous éliminés.
 */

export const loupsSettingsSchema = z.object({
  debateSeconds: z.number().int().min(30).max(300).default(120),
});

export type LoupsSettings = z.infer<typeof loupsSettingsSchema>;

export type LoupsPhase = 'ready' | 'deal' | 'night' | 'reveal' | 'debate' | 'vote' | 'final';

export interface Check {
  round: number;
  targetId: string;
  wolf: boolean;
}

export interface Reveal {
  kind: 'night' | 'vote';
  victimName: string | null;
  victimRole: Role | null;
  saved: boolean;
}

export interface LoupsState {
  phase: LoupsPhase;
  settings: LoupsSettings;
  players: Record<string, string>;
  order: string[];
  roles: Record<string, Role>;
  alive: string[];
  /** Numéro de la nuit en cours (0 avant la première nuit). */
  round: number;
  seen: Record<string, true>;
  /** Actions de nuit : acteur -> cible. */
  acts: Record<string, string>;
  guardLast: string | null;
  checks: Record<string, Check[]>;
  votes: Record<string, string>;
  /** Joueurs éliminés, avec leur rôle (publics). */
  dead: { id: string; name: string; role: Role }[];
  reveal: Reveal | null;
  winner: Team | null;
  points: Record<string, number>;
  lastEvent: string;
  step: number;
  endsAt: number;
}

const DEAL_SECONDS = 90;
const NIGHT_SECONDS = 60;
const VOTE_SECONDS = 45;
const REVEAL_MS = 6000;
const WIN_POINTS = 100;

const PHASE_TIMERS = ['deal', 'night', 'reveal', 'debate', 'vote'] as const;
const NIGHT_ROLES: Role[] = ['loup', 'voyante', 'gardienne'];

const noPayload = z.object({}).passthrough().optional();
const targetSchema = z.object({ target: z.string().min(1).max(64) });

function nameOf(s: LoupsState, id: string): string {
  return s.players[id] ?? '?';
}

function roleOf(s: LoupsState, id: string): Role {
  return s.roles[id] ?? 'villageois';
}

function isNightRole(role: Role): boolean {
  return NIGHT_ROLES.includes(role);
}

/** Cibles possibles pour l'action du joueur dans la phase en cours. */
function targetsFor(s: LoupsState, id: string): string[] {
  if (!s.alive.includes(id)) return [];
  if (s.phase === 'night') {
    const role = roleOf(s, id);
    if (role === 'loup') return s.alive.filter((t) => roleOf(s, t) !== 'loup');
    if (role === 'voyante') return s.alive.filter((t) => t !== id);
    if (role === 'gardienne') return s.alive.filter((t) => t !== s.guardLast);
    return [];
  }
  if (s.phase === 'vote') return s.alive.filter((t) => t !== id);
  return [];
}

function nightActors(s: LoupsState): string[] {
  return s.alive.filter((id) => isNightRole(roleOf(s, id)));
}

/** Équipe qui a gagné, ou null si la partie continue. */
function winnerOf(s: LoupsState): Team | null {
  const wolves = s.alive.filter((id) => roleOf(s, id) === 'loup').length;
  const others = s.alive.length - wolves;
  if (wolves === 0) return 'village';
  if (wolves >= others) return 'loups';
  return null;
}

/** Passe à une nouvelle phase : annule les minuteurs, arme celui de la phase. */
function enter(s: LoupsState, phase: LoupsPhase, ms: number, ctx: GameContext): LoupsState {
  for (const key of PHASE_TIMERS) ctx.cancel(key);
  ctx.schedule(phase, ms);
  return { ...s, phase, step: s.step + 1, endsAt: ctx.now() + ms };
}

function finishGame(s: LoupsState, winner: Team, ctx: GameContext): LoupsState {
  for (const key of PHASE_TIMERS) ctx.cancel(key);
  const points = Object.fromEntries(s.order.map((id) => [id, teamOf(roleOf(s, id)) === winner ? WIN_POINTS : 0]));
  const verdict =
    winner === 'village' ? 'Le village a démasqué tous les loups !' : 'Les loups ont pris le contrôle du village !';
  return { ...s, phase: 'final', winner, points, reveal: null, lastEvent: verdict, step: s.step + 1, endsAt: 0 };
}

function teamOf(role: Role): Team {
  return ROLE_INFO[role].team;
}

function startNight(s: LoupsState, ctx: GameContext): LoupsState {
  const next = { ...s, round: s.round + 1, acts: {}, votes: {}, reveal: null };
  return enter(next, 'night', NIGHT_SECONDS * 1000, ctx);
}

function openDebate(s: LoupsState, ctx: GameContext): LoupsState {
  return enter({ ...s, votes: {} }, 'debate', s.settings.debateSeconds * 1000, ctx);
}

function openVote(s: LoupsState, ctx: GameContext): LoupsState {
  return enter({ ...s, votes: {} }, 'vote', VOTE_SECONDS * 1000, ctx);
}

/** Résout la nuit : victime majoritaire chez les loups, protection de la gardienne. */
function resolveNight(s: LoupsState, ctx: GameContext): LoupsState {
  const wolves = s.alive.filter((id) => roleOf(s, id) === 'loup');
  const tally = new Map<string, number>();
  for (const w of wolves) {
    const target = s.acts[w];
    if (target && s.alive.includes(target)) tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally.entries()].filter(([, n]) => n === top).map(([id]) => id);
  const victim = leaders.length > 0 ? (leaders[Math.floor(ctx.random() * leaders.length)] ?? null) : null;

  const guardId = s.alive.find((id) => roleOf(s, id) === 'gardienne') ?? null;
  const protectedId = guardId ? (s.acts[guardId] ?? null) : null;
  const saved = victim !== null && victim === protectedId;
  const killed = victim !== null && !saved;

  const alive = killed ? s.alive.filter((id) => id !== victim) : s.alive;
  const dead =
    killed && victim ? [...s.dead, { id: victim, name: nameOf(s, victim), role: roleOf(s, victim) }] : s.dead;

  let lastEvent = 'Aucune victime cette nuit';
  if (killed && victim) lastEvent = `${nameOf(s, victim)} a été dévoré(e) cette nuit`;
  else if (saved) lastEvent = 'Les loups ont attaqué, mais la cible était protégée';

  const next: LoupsState = {
    ...s,
    alive,
    dead,
    guardLast: guardId ? (s.acts[guardId] ?? null) : s.guardLast,
    reveal: {
      kind: 'night',
      victimName: killed && victim ? nameOf(s, victim) : null,
      victimRole: killed && victim ? roleOf(s, victim) : null,
      saved,
    },
    lastEvent,
  };

  const winner = winnerOf(next);
  if (winner) return finishGame(next, winner, ctx);
  return enter(next, 'reveal', REVEAL_MS, ctx);
}

/** Dépouille le vote : le joueur le plus désigné est éliminé, sauf égalité. */
function resolveVote(s: LoupsState, ctx: GameContext): LoupsState {
  const tally = new Map<string, number>();
  for (const target of Object.values(s.votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally.entries()].filter(([, n]) => n === top).map(([id]) => id);
  const eliminated = top > 0 && leaders.length === 1 ? (leaders[0] ?? null) : null;

  let next: LoupsState;
  if (eliminated) {
    next = {
      ...s,
      alive: s.alive.filter((id) => id !== eliminated),
      dead: [...s.dead, { id: eliminated, name: nameOf(s, eliminated), role: roleOf(s, eliminated) }],
      reveal: {
        kind: 'vote',
        victimName: nameOf(s, eliminated),
        victimRole: roleOf(s, eliminated),
        saved: false,
      },
      lastEvent: `${nameOf(s, eliminated)} est éliminé(e) par le village`,
    };
  } else {
    next = {
      ...s,
      reveal: { kind: 'vote', victimName: null, victimRole: null, saved: false },
      lastEvent: 'Égalité : personne n’est éliminé(e)',
    };
  }

  const winner = winnerOf(next);
  if (winner) return finishGame(next, winner, ctx);
  return enter(next, 'reveal', REVEAL_MS, ctx);
}

/** Après la révélation : la nuit tombe après un vote, le débat commence après une nuit. */
function afterReveal(s: LoupsState, ctx: GameContext): LoupsState {
  if (s.reveal?.kind === 'night') return openDebate(s, ctx);
  return startNight(s, ctx);
}

/** Temps écoulé ou action forcée de l'hôte : fait avancer la phase en cours. */
function advancePhase(s: LoupsState, ctx: GameContext): LoupsState {
  switch (s.phase) {
    case 'deal':
      return startNight(s, ctx);
    case 'night':
      return resolveNight(s, ctx);
    case 'reveal':
      return afterReveal(s, ctx);
    case 'debate':
      return openVote(s, ctx);
    case 'vote':
      return resolveVote(s, ctx);
    default:
      return s;
  }
}

export const loupsVillage: GameModule<LoupsState, LoupsSettings> = {
  manifest: {
    id: 'loups-village',
    category: 'role',
    name: 'Les Loups du village',
    description: 'Les loups dévorent le village la nuit. Le jour, démasquez-les avant qu’il ne soit trop tard.',
    icon: '🐺',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 4,
    maxPlayers: 12,
    durationMin: 25,
    notice: {
      goal: 'Les villageois démasquent tous les loups. Les loups dévorent le village jusqu’à le contrôler.',
      steps: [
        'Chacun regarde son rôle en secret sur son téléphone.',
        'La nuit, les loups choisissent une victime, la voyante inspecte un joueur, la gardienne en protège un.',
        'Le jour, débattez à voix haute puis votez pour éliminer un suspect.',
        'La partie s’arrête quand les loups sont tous éliminés, ou quand ils sont aussi nombreux que les autres.',
      ],
      tips: [
        'Une égalité au vote n’élimine personne.',
        'Les loups se reconnaissent entre eux. Ne les trahissez pas en votant pour un allié.',
      ],
    },
  },

  settingsSchema: loupsSettingsSchema,
  defaultSettings: loupsSettingsSchema.parse({}),

  actions: {
    seen: noPayload,
    night: targetSchema,
    vote: targetSchema,
  },

  initialize(settings, players: PlayerRef[]) {
    const parsed = loupsSettingsSchema.parse(settings);
    const order = players.map((p) => p.id);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      order,
      roles: {},
      alive: [],
      round: 0,
      seen: {},
      acts: {},
      guardLast: null,
      checks: {},
      votes: {},
      dead: [],
      reveal: null,
      winner: null,
      points: Object.fromEntries(order.map((id) => [id, 0])),
      lastEvent: 'En attente des joueurs',
      step: 0,
      endsAt: 0,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      players: { ...s.players, [p.id]: p.name },
      order: [...s.order, p.id],
      points: { ...s.points, [p.id]: 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const points = { ...s.points };
    delete players[p.id];
    delete points[p.id];
    return { ...s, players, points, order: s.order.filter((id) => id !== p.id) };
  },

  start(s, ctx): GameResult<LoupsState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.order.length < 4) return fail('Il faut au moins quatre joueurs');
    const deck = shuffle(compositionFor(s.order.length), ctx.random);
    const roles = Object.fromEntries(s.order.map((id, i) => [id, deck[i] ?? 'villageois']));
    const dealt: LoupsState = {
      ...s,
      roles,
      alive: [...s.order],
      seen: {},
      round: 0,
      lastEvent: 'Découvrez votre rôle',
    };
    return ok(enter(dealt, 'deal', DEAL_SECONDS * 1000, ctx));
  },

  handleAction(s, p, type, payload, ctx): GameResult<LoupsState> {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

    if (type === 'seen') {
      if (s.phase !== 'deal') return fail('Pas de distribution en cours');
      if (p.id in s.seen) return ok(s);
      const next = { ...s, seen: { ...s.seen, [p.id]: true as const } };
      const done = everyConnectedDone(ctx, s.alive, (id) => id in next.seen);
      return ok(done ? startNight(next, ctx) : next);
    }

    if (type === 'night') {
      if (s.phase !== 'night') return fail('Ce n’est pas la nuit');
      if (!s.alive.includes(p.id)) return fail('Vous êtes éliminé(e)');
      if (!isNightRole(roleOf(s, p.id))) return fail('Vous dormez cette nuit');
      if (p.id in s.acts) return fail('Action déjà enregistrée');
      const parsed = targetSchema.safeParse(payload);
      if (!parsed.success) return fail('Cible invalide');
      const target = parsed.data.target;
      if (!targetsFor(s, p.id).includes(target)) return fail('Cible non autorisée');

      let next: LoupsState = { ...s, acts: { ...s.acts, [p.id]: target } };
      if (roleOf(s, p.id) === 'voyante') {
        const check: Check = { round: s.round, targetId: target, wolf: roleOf(s, target) === 'loup' };
        next = { ...next, checks: { ...next.checks, [p.id]: [...(next.checks[p.id] ?? []), check] } };
      }
      const done = everyConnectedDone(ctx, nightActors(s), (id) => id in next.acts);
      return ok(done ? resolveNight(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote') return fail('Pas de vote en cours');
      if (!s.alive.includes(p.id)) return fail('Vous êtes éliminé(e)');
      if (p.id in s.votes) return fail('Vote déjà enregistré');
      const parsed = targetSchema.safeParse(payload);
      if (!parsed.success) return fail('Vote invalide');
      const target = parsed.data.target;
      if (!targetsFor(s, p.id).includes(target)) return fail('Vote non autorisé');
      const next = { ...s, votes: { ...s.votes, [p.id]: target } };
      const done = everyConnectedDone(ctx, s.alive, (id) => id in next.votes);
      return ok(done ? resolveVote(next, ctx) : next);
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key !== s.phase) return s;
    return advancePhase(s, ctx);
  },

  nextRound(s, ctx) {
    return advancePhase(s, ctx);
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    for (const key of PHASE_TIMERS) ctx.cancel(key);
    return { ...s, phase: 'final', winner: s.winner ?? null, endsAt: 0 };
  },

  getPublicState(s) {
    const durationMs =
      s.phase === 'deal'
        ? DEAL_SECONDS * 1000
        : s.phase === 'night'
          ? NIGHT_SECONDS * 1000
          : s.phase === 'debate'
            ? s.settings.debateSeconds * 1000
            : s.phase === 'vote'
              ? VOTE_SECONDS * 1000
              : s.phase === 'reveal'
                ? REVEAL_MS
                : 0;
    const finalRoles =
      s.phase === 'final' ? s.order.map((id) => ({ id, name: nameOf(s, id), role: roleOf(s, id) })) : null;
    return {
      phase: s.phase,
      round: s.round,
      players: s.order.map((id) => ({
        id,
        name: nameOf(s, id),
        alive: s.alive.includes(id),
        seen: id in s.seen,
      })),
      aliveCount: s.alive.length,
      dead: s.dead,
      reveal: s.reveal,
      voteCount: Object.keys(s.votes).length,
      winner: s.winner,
      finalRoles,
      lastEvent: s.lastEvent,
      endsAt: s.endsAt,
      durationMs,
      ranking: rankEntries(s.players, s.points),
    };
  },

  getPlayerState(s, playerId) {
    const role = s.roles[playerId] ?? null;
    const alive = s.alive.includes(playerId);
    const nightRole = role !== null && isNightRole(role);
    const acted = playerId in s.acts;
    const targets = targetsFor(s, playerId);
    const allies =
      role === 'loup'
        ? s.order.filter((id) => roleOf(s, id) === 'loup' && id !== playerId).map((id) => nameOf(s, id))
        : [];
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;

    return {
      role,
      roleInfo: role ? ROLE_INFO[role] : null,
      alive,
      seen: playerId in s.seen,
      canSeen: s.phase === 'deal' && !(playerId in s.seen),
      canAct: s.phase === 'night' && alive && nightRole && !acted,
      acted,
      canVote: s.phase === 'vote' && alive && !(playerId in s.votes),
      voted: s.votes[playerId] ?? null,
      targets: targets.map((id) => ({ id, name: nameOf(s, id) })),
      checks: (s.checks[playerId] ?? []).map((c) => ({
        round: c.round,
        name: nameOf(s, c.targetId),
        wolf: c.wolf,
      })),
      allies,
      points: s.points[playerId] ?? 0,
      rank,
      winner: s.winner,
      won: s.winner !== null && role !== null && ROLE_INFO[role].team === s.winner,
    };
  },

  getHostState(s) {
    const actors = nightActors(s);
    return {
      seenCount: Object.keys(s.seen).length,
      total: s.order.length,
      nightDone: actors.filter((id) => id in s.acts).length,
      nightTotal: actors.length,
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase === 'deal' && !(playerId in s.seen)) {
      return { type: 'seen', key: `d${s.round}` };
    }
    if (
      s.phase === 'night' &&
      s.alive.includes(playerId) &&
      isNightRole(roleOf(s, playerId)) &&
      !(playerId in s.acts)
    ) {
      const options = targetsFor(s, playerId);
      const target = options[Math.floor(random() * options.length)];
      if (!target) return null;
      return { type: 'night', payload: { target }, key: `n${s.round}` };
    }
    if (s.phase === 'vote' && s.alive.includes(playerId) && !(playerId in s.votes)) {
      const options = targetsFor(s, playerId);
      const target = options[Math.floor(random() * options.length)];
      if (!target) return null;
      return { type: 'vote', payload: { target }, key: `v${s.round}` };
    }
    return null;
  },
};
