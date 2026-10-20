import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';

/**
 * Plus ou moins : un jeu de cartes à 52 cartes. Une carte est affichée sur
 * l’écran principal ; chacun parie en secret si la suivante sera plus haute
 * ou plus basse. L’as est la carte la plus haute. Une égalité ne rapporte rien
 * à personne. Le paquet est mélangé sur le serveur : la carte suivante n’est
 * jamais envoyée avant la révélation.
 */

export type Suit = '♠' | '♥' | '♦' | '♣';

export interface Card {
  /** 2 à 14 (14 = as). */
  rank: number;
  suit: Suit;
}

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];

function fullDeck(random: () => number): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) cards.push({ rank, suit });
  }
  return shuffle(cards, random);
}

export const plusOuMoinsSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(30).default(12),
  betSeconds: z.number().int().min(5).max(60).default(15),
});

export type PlusOuMoinsSettings = z.infer<typeof plusOuMoinsSettingsSchema>;

export type Bet = 'higher' | 'lower';

const BET_POINTS = 100;
const REVEAL_MS = 6000;
const BET_TIMEOUT = 'bet-timeout';
const REVEAL_NEXT = 'reveal-next';

const betSchema = z.object({ direction: z.enum(['higher', 'lower']) });

export type PlusOuMoinsPhase = 'ready' | 'bet' | 'reveal' | 'final';

export interface PlusOuMoinsState {
  phase: PlusOuMoinsPhase;
  settings: PlusOuMoinsSettings;
  deck: Card[];
  round: number;
  total: number;
  /** Carte affichée pendant le pari. */
  current: Card | null;
  /** Carte révélée à la fin du pari (devient la carte courante ensuite). */
  revealed: Card | null;
  players: Record<string, string>;
  points: Record<string, number>;
  bets: Record<string, Bet>;
  /** Résultat par joueur : correct = null en cas d’égalité. */
  results: Record<string, { correct: boolean | null; gained: number }>;
  endsAt: number;
}

function openBet(s: PlusOuMoinsState, ctx: GameContext): PlusOuMoinsState {
  ctx.cancel(REVEAL_NEXT);
  const ms = s.settings.betSeconds * 1000;
  ctx.schedule(BET_TIMEOUT, ms);
  return {
    ...s,
    phase: 'bet',
    bets: {},
    results: {},
    revealed: null,
    endsAt: ctx.now() + ms,
  };
}

function reveal(s: PlusOuMoinsState, ctx: GameContext): PlusOuMoinsState {
  ctx.cancel(BET_TIMEOUT);
  const [next, ...rest] = s.deck;
  const current = s.current;

  const results: Record<string, { correct: boolean | null; gained: number }> = {};
  let points = s.points;

  for (const id of Object.keys(s.players)) {
    const bet = s.bets[id];
    if (!current || !next || next.rank === current.rank) {
      // Égalité ou carte manquante : personne ne gagne ni ne perd.
      results[id] = { correct: null, gained: 0 };
      continue;
    }
    const higher = next.rank > current.rank;
    // Pas de pari = erreur (aucun point).
    const correct = bet !== undefined && (bet === 'higher') === higher;
    const gained = correct ? BET_POINTS : 0;
    results[id] = { correct, gained };
    points = addPoints(points, id, gained);
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return {
    ...s,
    phase: 'reveal',
    deck: rest,
    revealed: next ?? null,
    points,
    results,
    endsAt: ctx.now() + REVEAL_MS,
  };
}

function advance(s: PlusOuMoinsState, ctx: GameContext): PlusOuMoinsState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.total && s.revealed) {
    return openBet({ ...s, round: s.round + 1, current: s.revealed }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: PlusOuMoinsState, ctx: GameContext): PlusOuMoinsState {
  ctx.cancel(BET_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

export const plusOuMoins: GameModule<PlusOuMoinsState, PlusOuMoinsSettings> = {
  manifest: {
    id: 'plus-ou-moins',
    category: 'cartes',
    name: 'Plus ou moins',
    description: 'Une carte est tirée : la suivante sera-t-elle plus haute ou plus basse ?',
    icon: '🃏',
    version: '1.0.1',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 8,
    notice: {
      goal: 'Prévoir si la carte suivante sera plus haute ou plus basse.',
      steps: [
        'Une carte est affichée sur l’écran.',
        'Sur votre téléphone, pariez « plus haut » ou « plus bas ».',
        'La carte suivante est révélée : chaque bon pari rapporte 100 points.',
        'L’as est la carte la plus haute. Une égalité ne rapporte rien à personne.',
      ],
      tips: [
        'Les paris restent secrets jusqu’à la révélation.',
        'Le paquet est mélangé sur le serveur, la carte suivante n’est jamais envoyée avant.',
      ],
    },
  },

  settingsSchema: plusOuMoinsSettingsSchema,
  defaultSettings: plusOuMoinsSettingsSchema.parse({}),

  actions: {
    bet: betSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = plusOuMoinsSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      deck: fullDeck(ctx.random),
      round: 0,
      total: parsed.rounds,
      current: null,
      revealed: null,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      bets: {},
      results: {},
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
    const [first, ...rest] = s.deck;
    if (!first) return fail('Paquet vide');
    return ok(openBet({ ...s, deck: rest, current: first, round: 0, total: s.settings.rounds }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (type !== 'bet') return fail('Action inconnue');
    if (s.phase !== 'bet') return fail('Pas de pari en cours');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (p.id in s.bets) return fail('Pari déjà enregistré');

    const parsed = betSchema.safeParse(payload);
    if (!parsed.success) return fail('Pari invalide');

    const next = { ...s, bets: { ...s.bets, [p.id]: parsed.data.direction } };
    const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.bets);
    return ok(done ? reveal(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === BET_TIMEOUT && s.phase === 'bet') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'bet') return reveal(s, ctx);
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
      total: s.total,
      ranking: rankEntries(s.players, s.points),
      current: s.phase === 'ready' || s.phase === 'final' ? null : s.current,
      endsAt: s.endsAt,
    };

    if (s.phase === 'bet') {
      return {
        ...base,
        durationMs: s.settings.betSeconds * 1000,
        revealed: null,
        betCount: Object.keys(s.bets).length,
        playerCount: Object.keys(s.players).length,
      };
    }

    if (s.phase === 'reveal') {
      const picks = Object.keys(s.players)
        .map((id) => ({
          playerId: id,
          name: s.players[id] ?? '?',
          bet: s.bets[id] ?? null,
          correct: s.results[id]?.correct ?? null,
          gained: s.results[id]?.gained ?? 0,
        }))
        .sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name, 'fr'));
      return { ...base, revealed: s.revealed, picks };
    }

    return { ...base, revealed: null };
  },

  getPlayerState(s, playerId) {
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    const result = s.results[playerId];
    return {
      points: s.points[playerId] ?? 0,
      rank,
      myBet: s.bets[playerId] ?? null,
      answered: s.phase === 'bet' ? playerId in s.bets : false,
      correct: s.phase === 'reveal' ? (result?.correct ?? null) : null,
      gained: s.phase === 'reveal' ? (result?.gained ?? 0) : null,
    };
  },

  getHostState(s) {
    const pending = s.phase === 'bet' ? Object.keys(s.players).filter((id) => !(id in s.bets)) : [];
    return { pending: pending.map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },
  suggest(s, playerId, random) {
    if (s.phase !== 'bet' || playerId in s.bets) return null;
    return { type: 'bet', payload: { direction: random() < 0.5 ? 'higher' : 'lower' }, key: `b${s.round}` };
  },
};
