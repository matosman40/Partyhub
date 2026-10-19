import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';

/**
 * {{name}} : à chaque manche, chacun choisit pile ou face. Quand tout le monde a choisi, le serveur
 * lance la pièce. Les joueurs qui ont trouvé le bon côté marquent un point.
 *
 * Ce fichier est le module serveur du jeu : il décrit les règles et ne voit jamais les choix
 * des autres avant le lancer. Les écrans sont dans src/client.tsx.
 */

const settingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(3),
});

const choiceSchema = z.object({ choice: z.enum(['pile', 'face']) });

type Settings = z.infer<typeof settingsSchema>;
type Choice = z.infer<typeof choiceSchema>['choice'];
type Phase = 'pick' | 'reveal' | 'final';

interface State {
  phase: Phase;
  settings: Settings;
  round: number;
  players: Record<string, string>;
  points: Record<string, number>;
  choices: Record<string, Choice>;
  result: Choice | null;
}

/** Minuteur : délai avant la manche suivante, après le lancer. */
const REVEAL_NEXT = 'reveal-next';
const REVEAL_MS = 3000;

const manifest: GameModule['manifest'] = {
  id: '{{id}}',
  category: 'plateau',
  name: '{{name}}',
  description: 'Chacun choisit pile ou face : les bons choix rapportent un point.',
  icon: '🪙',
  version: '0.1.0',
  apiVersion: 1,
  minPlayers: 1,
  maxPlayers: 12,
  durationMin: 3,
  notice: {
    goal: 'Avoir le plus de points à la fin des manches.',
    steps: [
      'Chacun choisit pile ou face sur son téléphone.',
      'Quand tout le monde a choisi, la pièce est lancée.',
      'Les joueurs qui ont trouvé le bon côté marquent un point.',
    ],
    tips: ['Le choix reste secret jusqu’au lancer.'],
  },
};

/** Lance la pièce et attribue les points. Ne s'exécute qu'une fois que tout le monde a choisi. */
function flip(state: State, ctx: GameContext): State {
  const result: Choice = ctx.random() < 0.5 ? 'pile' : 'face';
  const points = { ...state.points };
  for (const [playerId, choice] of Object.entries(state.choices)) {
    if (choice === result) points[playerId] = (points[playerId] ?? 0) + 1;
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...state, phase: 'reveal', result, points };
}

/** Passe à la manche suivante, ou termine la partie. */
function advance(state: State): State {
  if (state.phase !== 'reveal') return state;
  if (state.round >= state.settings.rounds) return { ...state, phase: 'final', choices: {} };
  return { ...state, phase: 'pick', round: state.round + 1, choices: {}, result: null };
}

function publicView(state: State) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.settings.rounds,
    players: state.players,
    points: state.points,
    result: state.phase === 'pick' ? null : state.result,
    answered: Object.keys(state.choices),
  };
}

const game: GameModule<State, Settings> = {
  manifest,
  settingsSchema,
  defaultSettings: { rounds: 3 },
  actions: { choisir: choiceSchema },

  initialize(settings: Settings, players: PlayerRef[]): State {
    return {
      phase: 'pick',
      settings,
      round: 0,
      players: Object.fromEntries(players.map((p) => [p.id, p.name])),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      choices: {},
      result: null,
    };
  },

  onPlayerJoin(state: State, player: PlayerRef): State {
    return {
      ...state,
      players: { ...state.players, [player.id]: player.name },
      points: { ...state.points, [player.id]: state.points[player.id] ?? 0 },
    };
  },

  onPlayerLeave(state: State, player: PlayerRef): State {
    const players = { ...state.players };
    delete players[player.id];
    return { ...state, players };
  },

  start(state: State): GameResult<State> {
    if (Object.keys(state.players).length === 0) return { ok: false, error: 'Il faut au moins un joueur.' };
    return { ok: true, state: { ...state, round: 1 } };
  },

  handleAction(state: State, player: PlayerRef, type: string, payload: unknown, ctx: GameContext): GameResult<State> {
    if (type !== 'choisir') return { ok: false, error: 'Action inconnue.' };
    if (state.phase !== 'pick') return { ok: false, error: 'Ce n’est pas le moment de choisir.' };
    if (!(player.id in state.players)) return { ok: false, error: 'Vous ne jouez pas cette partie.' };
    if (state.choices[player.id]) return { ok: false, error: 'Vous avez déjà choisi.' };
    const parsed = choiceSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'Choix invalide.' };

    const choices = { ...state.choices, [player.id]: parsed.data.choice };
    const next: State = { ...state, choices };
    const waiting = ctx.connectedPlayerIds().filter((id) => id in state.players && !(id in choices));
    return { ok: true, state: waiting.length === 0 ? flip(next, ctx) : next };
  },

  onTimer(state: State, key: string): State {
    return key === REVEAL_NEXT ? advance(state) : state;
  },

  nextRound(state: State): State {
    return advance(state);
  },

  end(state: State): State {
    return { ...state, phase: 'final' };
  },

  calculateScores(state: State): ScoreEntry[] {
    const rows = Object.keys(state.players).map((id) => ({
      playerId: id,
      name: state.players[id] ?? id,
      points: state.points[id] ?? 0,
    }));
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    let rank = 0;
    let previous: number | null = null;
    return rows.map((row, index) => {
      if (row.points !== previous) {
        rank = index + 1;
        previous = row.points;
      }
      return { ...row, rank };
    });
  },

  getPublicState(state: State) {
    return publicView(state);
  },

  getPlayerState(state: State, playerId: string) {
    return {
      phase: state.phase,
      yourChoice: state.choices[playerId] ?? null,
      result: state.phase === 'pick' ? null : state.result,
      points: state.points[playerId] ?? 0,
    };
  },

  getHostState(state: State) {
    return { ...publicView(state), choices: state.phase === 'pick' ? null : state.choices };
  },

  isFinished(state: State): boolean {
    return state.phase === 'final';
  },

  /** Mode test : un robot choisit au hasard, une fois par manche. */
  suggest(state: State, playerId: string, random: () => number) {
    if (state.phase !== 'pick' || !(playerId in state.players) || state.choices[playerId]) return null;
    return { type: 'choisir', payload: { choice: random() < 0.5 ? 'pile' : 'face' }, key: `${state.round}:${playerId}` };
  },
};

export default game;
