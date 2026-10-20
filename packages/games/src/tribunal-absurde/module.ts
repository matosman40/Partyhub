import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import rawSituations from './situations.fr.json' with { type: 'json' };
import {
  DEFENSE_MAX_LENGTH,
  TRIBUNAL_AMBIANCES,
  TRIBUNAL_MODES,
  TRIBUNAL_MODE_INFO,
  type TribunalMode,
} from './info.js';

/**
 * Le Tribunal de l’absurde : une situation improbable apparaît sur l’écran principal. Chaque joueur écrit sa
 * défense sur son téléphone. Puis le jury, ce sont les autres joueurs, vote anonymement pour la meilleure.
 * Chaque vote rapporte 100 points à l’auteur de la défense. La défense la plus votée est acquittée ; celles qui
 * n’ont reçu aucun vote sont condamnées. Personne ne vote pour sa propre défense.
 */

const situationsSchema = z.record(z.enum(TRIBUNAL_MODES), z.array(z.string().min(10)).min(3));
const SITUATIONS = situationsSchema.parse(rawSituations) as Record<TribunalMode, string[]>;

export const tribunalSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(8).default(4),
  writeSeconds: z.number().int().min(20).max(120).default(45),
  ambiance: z.enum(TRIBUNAL_AMBIANCES).default('melange'),
});

export type TribunalSettings = z.infer<typeof tribunalSettingsSchema>;

const VOTE_SECONDS = 25;
const VOTE_POINTS = 100;
const REVEAL_MS = 9000;
/** Au-delà de ce nombre de défenses, le vote n’est plus lisible sur un téléphone. */
const MAX_OPTIONS = 12;

const WRITE_TIMEOUT = 'write-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

const defenseSchema = z.object({ text: z.string().trim().min(1).max(DEFENSE_MAX_LENGTH) });
const voteSchema = z.object({
  option: z
    .number()
    .int()
    .min(0)
    .max(MAX_OPTIONS - 1),
});

export type TribunalPhase = 'ready' | 'write' | 'vote' | 'reveal' | 'final';
export type Verdict = 'acquittee' | 'condamnee';

export interface TribunalCase {
  mode: TribunalMode;
  situation: string;
}

export interface TribunalState {
  phase: TribunalPhase;
  settings: TribunalSettings;
  cases: TribunalCase[];
  round: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** auteur -> défense écrite pendant la manche en cours. */
  defenses: Record<string, string>;
  /** Auteurs dans l’ordre d’affichage anonyme du vote. */
  options: string[];
  /** votant -> index de la défense choisie. */
  votes: Record<string, number>;
  /** Points gagnés pendant la manche, révélés au verdict. */
  gains: Record<string, number>;
  endsAt: number;
}

/** Tire les affaires d’une partie : une ambiance par affaire en « mélange », sans situation répétée. */
export function buildCases(settings: TribunalSettings, random: () => number): TribunalCase[] {
  const modes = shuffle(TRIBUNAL_MODES, random);
  const pools = Object.fromEntries(TRIBUNAL_MODES.map((mode) => [mode, shuffle(SITUATIONS[mode], random)])) as Record<
    TribunalMode,
    string[]
  >;
  const used: Record<TribunalMode, number> = {
    'humour-noir': 0,
    'mauvaise-foi': 0,
    'excuses-impossibles': 0,
    adultes: 0,
  };
  return Array.from({ length: settings.rounds }, (_, i) => {
    const mode: TribunalMode = settings.ambiance === 'melange' ? modes[i % modes.length]! : settings.ambiance;
    const pool = pools[mode];
    const situation = pool[used[mode] % pool.length]!;
    used[mode] += 1;
    return { mode, situation };
  });
}

/** Verdict d’une défense, à partir des votes de la manche. Null quand il n’y a pas eu de vote. */
function verdictOf(s: TribunalState, option: number): Verdict | null {
  if (s.options.length < 2) return null;
  const counts = s.options.map((_, i) => Object.values(s.votes).filter((v) => v === i).length);
  const top = Math.max(0, ...counts);
  return (counts[option] ?? 0) > 0 && counts[option] === top ? 'acquittee' : 'condamnee';
}

function clearRoundTimers(ctx: GameContext): void {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
}

function openWriting(s: TribunalState, ctx: GameContext): TribunalState {
  clearRoundTimers(ctx);
  const ms = s.settings.writeSeconds * 1000;
  ctx.schedule(WRITE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'write',
    defenses: {},
    options: [],
    votes: {},
    gains: {},
    endsAt: ctx.now() + ms,
  };
}

/** Un joueur peut voter s’il n’a pas encore voté et si au moins une défense n’est pas la sienne. */
function canVote(s: TribunalState, id: string): boolean {
  return !(id in s.votes) && s.options.some((author) => author !== id);
}

function openVote(s: TribunalState, ctx: GameContext): TribunalState {
  ctx.cancel(WRITE_TIMEOUT);
  const options = shuffle(Object.keys(s.defenses), ctx.random);
  // Sans au moins deux défenses, il n’y a rien à départager : on passe directement au verdict.
  if (options.length < 2) return reveal({ ...s, options }, ctx);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', options, votes: {}, endsAt: ctx.now() + ms };
}

function reveal(s: TribunalState, ctx: GameContext): TribunalState {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);

  const gains: Record<string, number> = {};
  for (const option of Object.values(s.votes)) {
    const author = s.options[option];
    if (author) gains[author] = (gains[author] ?? 0) + VOTE_POINTS;
  }

  const points = { ...s.points };
  for (const [id, gained] of Object.entries(gains)) {
    points[id] = (points[id] ?? 0) + gained;
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: TribunalState, ctx: GameContext): TribunalState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.cases.length) {
    return openWriting({ ...s, round: s.round + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: TribunalState, ctx: GameContext): TribunalState {
  clearRoundTimers(ctx);
  return { ...s, phase: 'final' };
}

const BOT_DEFENSES = [
  'C’est la faute de la Lune, Votre Honneur.',
  'Le mot de passe était « 1234 ». Tout le monde le connaissait.',
  'J’essayais seulement de le protéger.',
  'Mon ex m’a dit de le faire, et il faut toujours écouter son ex.',
  'La machine a mal compris. Je le jure sur mon chat.',
  'Je voulais surprendre le patron. C’est réussi, non ?',
];

export const tribunalAbsurde: GameModule<TribunalState, TribunalSettings> = {
  manifest: {
    id: 'tribunal-absurde',
    category: 'quiz',
    name: 'Le Tribunal de l’absurde',
    description: 'Une situation improbable : écrivez votre défense, puis le jury vote pour la meilleure.',
    icon: '⚖️',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 3,
    maxPlayers: 10,
    durationMin: 15,
    notice: {
      goal: 'Trouver la défense la plus convaincante, ou la plus absurde, pour une situation improbable.',
      steps: [
        'Lisez la situation sur l’écran principal.',
        'Écrivez votre défense sur votre téléphone (140 caractères maximum).',
        'Le jury, ce sont les autres joueurs : votez pour la meilleure défense, sans savoir qui l’a écrite.',
        'Chaque vote reçu rapporte 100 points à l’auteur. La défense la plus votée est acquittée.',
      ],
      tips: [
        'Vous ne pouvez pas voter pour votre propre défense.',
        'Chaque ambiance a son ton : « Mélange » change de ton à chaque affaire.',
      ],
    },
  },

  settingsSchema: tribunalSettingsSchema,
  defaultSettings: tribunalSettingsSchema.parse({}),

  actions: {
    defense: defenseSchema,
    vote: voteSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = tribunalSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      cases: buildCases(parsed, ctx.random),
      round: 0,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      defenses: {},
      options: [],
      votes: {},
      gains: {},
      endsAt: 0,
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
    if (s.cases.length === 0) return fail('Aucune affaire disponible');
    return ok(openWriting(s, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

    if (type === 'defense') {
      if (s.phase !== 'write') return fail('Les défenses ne sont pas attendues maintenant');
      if (p.id in s.defenses) return fail('Défense déjà envoyée');
      const parsed = defenseSchema.safeParse(payload);
      if (!parsed.success) return fail('Défense invalide');
      const next = { ...s, defenses: { ...s.defenses, [p.id]: parsed.data.text } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.defenses);
      return ok(done ? openVote(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote') return fail('Pas de vote en cours');
      if (p.id in s.votes) return fail('Vote déjà enregistré');
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return fail('Vote invalide');
      const { option } = parsed.data;
      if (option >= s.options.length) return fail('Choix invalide');
      if (s.options[option] === p.id) return fail('Vous ne pouvez pas voter pour votre propre défense');
      const next = { ...s, votes: { ...s.votes, [p.id]: option } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => !canVote(next, id));
      return ok(done ? reveal(next, ctx) : next);
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key === WRITE_TIMEOUT && s.phase === 'write') return openVote(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'write') return openVote(s, ctx);
    if (s.phase === 'vote') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const base = {
      phase: s.phase,
      round: s.round,
      total: s.cases.length,
      playerCount: Object.keys(s.players).length,
      ranking: rankEntries(s.players, s.points),
    };

    if (s.phase === 'ready' || s.phase === 'final') {
      return { ...base, mode: null, modeLabel: null, hint: null, situation: null };
    }

    const current = s.cases[s.round] ?? null;
    const info = current ? TRIBUNAL_MODE_INFO[current.mode] : null;
    const common = {
      ...base,
      mode: current?.mode ?? null,
      modeLabel: info?.label ?? null,
      hint: info?.hint ?? null,
      situation: current?.situation ?? null,
    };

    if (s.phase === 'write') {
      return {
        ...common,
        endsAt: s.endsAt,
        durationMs: s.settings.writeSeconds * 1000,
        writtenCount: Object.keys(s.defenses).length,
      };
    }

    if (s.phase === 'vote') {
      return {
        ...common,
        endsAt: s.endsAt,
        durationMs: VOTE_SECONDS * 1000,
        // Anonymat : on montre les défenses, jamais leurs auteurs.
        options: s.options.map((id) => s.defenses[id] ?? ''),
        voteCount: Object.keys(s.votes).length,
      };
    }

    // reveal : les auteurs, les votes et les verdicts deviennent publics.
    const results = s.options
      .map((id, i) => ({
        defense: s.defenses[id] ?? '',
        author: s.players[id] ?? '?',
        votes: Object.values(s.votes).filter((v) => v === i).length,
        gained: s.gains[id] ?? 0,
        verdict: verdictOf(s, i),
      }))
      .sort((a, b) => b.votes - a.votes || a.author.localeCompare(b.author, 'fr'));

    return { ...common, endsAt: s.endsAt, results };
  },

  getPlayerState(s, playerId) {
    const myOption = s.options.indexOf(playerId);
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      myDefense: s.defenses[playerId] ?? null,
      myOption: myOption >= 0 ? myOption : null,
      myVote: s.votes[playerId] ?? null,
      answered: s.phase === 'write' ? playerId in s.defenses : s.phase === 'vote' ? !canVote(s, playerId) : false,
      gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
      verdict: s.phase === 'reveal' && myOption >= 0 ? verdictOf(s, myOption) : null,
    };
  },

  getHostState(s) {
    const missing =
      s.phase === 'write'
        ? Object.keys(s.players).filter((id) => !(id in s.defenses))
        : s.phase === 'vote'
          ? Object.keys(s.players).filter((id) => canVote(s, id))
          : [];
    return { pending: missing.map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase === 'write' && !(playerId in s.defenses)) {
      const text = BOT_DEFENSES[Math.floor(random() * BOT_DEFENSES.length)]!;
      return { type: 'defense', payload: { text }, key: `d${s.round}` };
    }
    if (s.phase === 'vote' && canVote(s, playerId)) {
      const choices = s.options.map((_, i) => i).filter((i) => s.options[i] !== playerId);
      const option = choices[Math.floor(random() * choices.length)];
      if (option === undefined) return null;
      return { type: 'vote', payload: { option }, key: `v${s.round}` };
    }
    return null;
  },
};
