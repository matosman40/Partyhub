import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { directory, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import {
  BAIL,
  BOARD,
  BOARD_SIZE,
  CHANCE,
  CHEST,
  JAIL_INDEX,
  JAIL_TRIES,
  MAX_HOUSES,
  SALARY,
  START_CASH,
  STATION_RENT,
  UTILITY_FACTOR,
  groupSquares,
  type Card,
  type Square,
} from './board.js';

/**
 * Le Promoteur : jeu de plateau façon Monopoly. Chacun lance les dés à son tour,
 * achète les rues, construit des maisons sur une couleur complète et fait payer
 * les loyers. Le joueur le plus riche (liquidités + biens) gagne à la fin des tours.
 */

export const promoteurSettingsSchema = z.object({
  rounds: z.number().int().min(5).max(60).default(20),
  turnSeconds: z.number().int().min(0).max(120).default(45),
});

export type PromoteurSettings = z.infer<typeof promoteurSettingsSchema>;

export type PromoteurPhase = 'ready' | 'roll' | 'decide' | 'final';

export interface PromoteurState {
  phase: PromoteurPhase;
  settings: PromoteurSettings;
  players: Record<string, string>;
  order: string[];
  cash: Record<string, number>;
  pos: Record<string, number>;
  /** Joueurs en prison : nombre de tentatives ratées. */
  jail: Record<string, number>;
  bankrupt: string[];
  /** Case (en texte) -> identifiant du propriétaire. */
  owners: Record<string, string>;
  /** Case (en texte) -> nombre de maisons. */
  houses: Record<string, number>;
  current: string | null;
  round: number;
  /** Doubles consécutifs lancés pendant le tour en cours. */
  doubles: number;
  /** Vrai si le joueur courant relance après avoir résolu sa case (doubles). */
  repeat: boolean;
  dice: [number, number] | null;
  /** Case en attente de décision d'achat. */
  pending: number | null;
  chanceOrder: number[];
  chanceIndex: number;
  chestOrder: number[];
  chestIndex: number;
  lastEvent: string;
  /** Incrémenté à chaque étape visible : sert à relancer le minuteur de tour. */
  step: number;
  endsAt: number;
}

const TURN = 'turn';

const noPayload = z.object({}).passthrough().optional();
const buildSchema = z.object({ square: z.number().int().min(0).max(BOARD_SIZE - 1) });

const squareAt = (i: number): Square => BOARD[((i % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE]!;
const key = (i: number) => String(i);
const bump = (s: PromoteurState): PromoteurState => ({ ...s, step: s.step + 1 });

function clone(s: PromoteurState): PromoteurState {
  return {
    ...s,
    cash: { ...s.cash },
    pos: { ...s.pos },
    jail: { ...s.jail },
    bankrupt: [...s.bankrupt],
    owners: { ...s.owners },
    houses: { ...s.houses },
  };
}

function nameOf(s: PromoteurState, id: string): string {
  return s.players[id] ?? '?';
}

function isActive(s: PromoteurState, id: string): boolean {
  return !s.bankrupt.includes(id);
}

function ownedBy(s: PromoteurState, id: string): number[] {
  return BOARD.filter((sq) => s.owners[key(sq.index)] === id).map((sq) => sq.index);
}

function ownsGroup(s: PromoteurState, id: string, group: NonNullable<Square['group']>): boolean {
  return groupSquares(group).every((i) => s.owners[key(i)] === id);
}

/** Loyer dû pour une case appartenant à quelqu'un, selon le jet de dés. */
function rentOf(s: PromoteurState, index: number, diceSum: number): number {
  const sq = squareAt(index);
  const ownerId = s.owners[key(index)] ?? '';
  if (sq.kind === 'station') {
    const stations = ownedBy(s, ownerId).filter((i) => squareAt(i).kind === 'station').length;
    return STATION_RENT * 2 ** Math.max(0, stations - 1);
  }
  if (sq.kind === 'utility') return diceSum * UTILITY_FACTOR;
  const base = sq.rent ?? 0;
  const h = s.houses[key(index)] ?? 0;
  if (h > 0) return base * (1 + 3 * h);
  return sq.group && ownsGroup(s, ownerId, sq.group) ? base * 2 : base;
}

/** Valeur d'un joueur : liquidités, prix d'achat de ses rues et valeur de ses maisons. */
function worthOf(s: PromoteurState, id: string): number {
  let total = s.cash[id] ?? 0;
  for (const i of ownedBy(s, id)) {
    const sq = squareAt(i);
    total += sq.price ?? 0;
    total += (s.houses[key(i)] ?? 0) * (sq.house ?? 0);
  }
  return total;
}

function worthMap(s: PromoteurState): Record<string, number> {
  return Object.fromEntries(s.order.map((id) => [id, worthOf(s, id)]));
}

/** Motif pour lequel une maison ne peut pas être construite (null si c'est possible). */
function buildError(s: PromoteurState, id: string, index: number): string | null {
  const sq = squareAt(index);
  if (sq.kind !== 'street' || !sq.group) return 'Ce n’est pas une rue constructible';
  if (s.owners[key(index)] !== id) return 'Vous ne possédez pas cette rue';
  if (!ownsGroup(s, id, sq.group)) return 'Il faut posséder toute la couleur';
  const h = s.houses[key(index)] ?? 0;
  if (h >= MAX_HOUSES) return 'Nombre maximum de maisons atteint';
  const minH = Math.min(...groupSquares(sq.group).map((i) => s.houses[key(i)] ?? 0));
  if (h > minH) return 'Construisez d’abord sur les autres rues de la couleur';
  if ((s.cash[id] ?? 0) < (sq.house ?? 0)) return 'Argent insuffisant pour une maison';
  return null;
}

/** Vend toutes les maisons du joueur à la banque (moitié du prix). */
function raise(s: PromoteurState, id: string): PromoteurState {
  const n = clone(s);
  for (const i of ownedBy(n, id)) {
    const h = n.houses[key(i)] ?? 0;
    if (h > 0) {
      n.cash[id] = (n.cash[id] ?? 0) + (h * (squareAt(i).house ?? 0)) / 2;
      delete n.houses[key(i)];
    }
  }
  return n;
}

/** Faillite : biens et argent restant vont au créancier (ou à la banque). */
function goBankrupt(s: PromoteurState, id: string, creditor: string | null): PromoteurState {
  const n = clone(s);
  const remaining = Math.max(0, n.cash[id] ?? 0);
  const toPlayer = creditor !== null && creditor !== id && isActive(n, creditor) ? creditor : null;
  if (toPlayer) n.cash[toPlayer] = (n.cash[toPlayer] ?? 0) + remaining;
  n.cash[id] = 0;
  for (const k of Object.keys(n.owners)) {
    if (n.owners[k] !== id) continue;
    if (toPlayer) n.owners[k] = toPlayer;
    else {
      delete n.owners[k];
      delete n.houses[k];
    }
  }
  n.bankrupt = [...n.bankrupt, id];
  delete n.jail[id];
  n.lastEvent = `${nameOf(n, id)} est en faillite`;
  return n;
}

/** Paiement : vend des maisons si besoin, puis déclare la faillite si le joueur ne peut pas payer. */
function pay(s: PromoteurState, from: string, to: string | null, amount: number): PromoteurState {
  let n = clone(s);
  if ((n.cash[from] ?? 0) < amount) n = raise(n, from);
  if ((n.cash[from] ?? 0) >= amount) {
    n.cash[from] = (n.cash[from] ?? 0) - amount;
    if (to) n.cash[to] = (n.cash[to] ?? 0) + amount;
    return n;
  }
  return goBankrupt(n, from, to);
}

/** Avance de `dist` cases ; franchir le Départ rapporte le salaire. */
function step(s: PromoteurState, id: string, dist: number): PromoteurState {
  const n = clone(s);
  const raw = (n.pos[id] ?? 0) + dist;
  if (raw >= BOARD_SIZE) n.cash[id] = (n.cash[id] ?? 0) + SALARY;
  n.pos[id] = raw % BOARD_SIZE;
  return n;
}

/** Déplacement direct vers une case ; revenir en arrière en passant par le Départ rapporte aussi. */
function warp(s: PromoteurState, id: string, to: number): PromoteurState {
  const n = clone(s);
  const from = n.pos[id] ?? 0;
  if (to < from) n.cash[id] = (n.cash[id] ?? 0) + SALARY;
  n.pos[id] = to;
  return n;
}

function sendToJail(s: PromoteurState, id: string): PromoteurState {
  const n = clone(s);
  n.pos[id] = JAIL_INDEX;
  n.jail[id] = 0;
  n.doubles = 0;
  n.repeat = false;
  n.lastEvent = `${nameOf(n, id)} part en prison`;
  return n;
}

function enterDecide(s: PromoteurState, index: number): PromoteurState {
  const sq = squareAt(index);
  return bump({
    ...s,
    phase: 'decide',
    pending: index,
    lastEvent: `${nameOf(s, s.current ?? '')} peut acheter ${sq.name} pour ${sq.price ?? 0} €`,
  });
}

function drawCard(s: PromoteurState, id: string, kind: 'chance' | 'chest', diceSum: number): PromoteurState {
  let n = clone(s);
  let card: Card;
  if (kind === 'chance') {
    card = CHANCE[n.chanceOrder[n.chanceIndex % n.chanceOrder.length] ?? 0]!;
    n.chanceIndex += 1;
  } else {
    card = CHEST[n.chestOrder[n.chestIndex % n.chestOrder.length] ?? 0]!;
    n.chestIndex += 1;
  }
  n.lastEvent = `${nameOf(n, id)} : « ${card.text} »`;
  const effect = card.effect;
  if (effect.kind === 'money') {
    if (effect.amount >= 0) {
      n.cash[id] = (n.cash[id] ?? 0) + effect.amount;
      return n;
    }
    return pay(n, id, null, -effect.amount);
  }
  if (effect.kind === 'move') {
    return land(warp(n, id, effect.to), id, diceSum, false);
  }
  return sendToJail(n, id);
}

/** Résout la case d'arrivée : achat possible, loyer, impôt, carte ou prison. */
function land(s: PromoteurState, id: string, diceSum: number, allowCards: boolean): PromoteurState {
  const index = s.pos[id] ?? 0;
  const sq = squareAt(index);

  switch (sq.kind) {
    case 'tax': {
      const amount = sq.tax ?? 0;
      const n = clone(s);
      n.lastEvent = `${nameOf(n, id)} paie ${amount} € d’impôts`;
      return pay(n, id, null, amount);
    }
    case 'goToJail':
      return sendToJail(s, id);
    case 'chance':
    case 'chest':
      return allowCards ? drawCard(s, id, sq.kind, diceSum) : s;
    case 'street':
    case 'station':
    case 'utility': {
      const owner = s.owners[key(index)];
      const price = sq.price ?? 0;
      if (!owner) {
        if ((s.cash[id] ?? 0) >= price) return enterDecide(s, index);
        return { ...s, lastEvent: `${nameOf(s, id)} n’a pas assez d’argent pour ${sq.name}` };
      }
      if (owner === id || !isActive(s, owner)) return s;
      const rent = rentOf(s, index, diceSum);
      const n = clone(s);
      n.lastEvent = `${nameOf(n, id)} paie ${rent} € à ${nameOf(n, owner)}`;
      return pay(n, id, owner, rent);
    }
    default:
      return s;
  }
}

function beginRoll(s: PromoteurState): PromoteurState {
  return bump({
    ...s,
    phase: 'roll',
    pending: null,
    dice: s.dice,
    lastEvent: `À ${nameOf(s, s.current ?? '')} de jouer`,
  });
}

function finish(s: PromoteurState, ctx: GameContext): PromoteurState {
  ctx.cancel(TURN);
  const ranking = rankEntries(s.players, worthMap(s));
  const winners = ranking.filter((r) => r.rank === 1).map((r) => r.name);
  const verdict = winners.length > 1 ? `à égalité : ${winners.join(', ')}` : `${winners[0] ?? ''} l’emporte`;
  return bump({
    ...s,
    phase: 'final',
    current: null,
    pending: null,
    lastEvent: `Fin de partie · ${verdict}`,
  });
}

/** Passe la main au joueur suivant encore en jeu ; compte les tours complets. */
function endTurn(s: PromoteurState, ctx: GameContext): PromoteurState {
  const active = s.order.filter((id) => isActive(s, id));
  if (active.length <= 1) return finish(s, ctx);

  const len = s.order.length;
  const from = s.order.indexOf(s.current ?? '');
  let round = s.round;
  let next: string | null = null;
  for (let i = 1; i <= len; i++) {
    const j = from + i;
    const candidate = s.order[j % len];
    if (candidate && isActive(s, candidate)) {
      if (j >= len) round += 1;
      next = candidate;
      break;
    }
  }
  if (next === null || round > s.settings.rounds) return finish(s, ctx);

  return beginRoll({ ...s, current: next, round, doubles: 0, repeat: false, dice: null });
}

/** Ferme la décision d'achat (acheter ou laisser) puis enchaîne le tour. */
function resolvePending(s: PromoteurState, ctx: GameContext): PromoteurState {
  return afterAction({ ...s, phase: 'roll', pending: null }, ctx);
}

/** Après la résolution d'une case : relance (doubles) ou tour suivant. */
function afterAction(s: PromoteurState, ctx: GameContext): PromoteurState {
  if (s.phase === 'decide') return s;
  const id = s.current;
  if (!id) return s;
  if (!isActive(s, id) || s.jail[id] !== undefined) return endTurn(s, ctx);
  if (s.repeat) return beginRoll(s);
  return endTurn(s, ctx);
}

function leaveJail(s: PromoteurState, id: string, diceSum: number, ctx: GameContext): PromoteurState {
  let n = s;
  if (isActive(n, id)) {
    n = clone(n);
    delete n.jail[id];
    n = land(step(n, id, diceSum), id, diceSum, true);
  }
  return afterAction(n, ctx);
}

function rollDice(s: PromoteurState, ctx: GameContext): PromoteurState {
  const id = s.current ?? '';
  const d1 = Math.floor(ctx.random() * 6) + 1;
  const d2 = Math.floor(ctx.random() * 6) + 1;
  const sum = d1 + d2;
  const isDouble = d1 === d2;
  let n: PromoteurState = {
    ...s,
    dice: [d1, d2],
    repeat: false,
    lastEvent: `${nameOf(s, id)} fait ${d1} + ${d2} = ${sum}`,
  };

  if (n.jail[id] !== undefined) {
    if (isDouble) return leaveJail(n, id, sum, ctx);
    const tries = (n.jail[id] ?? 0) + 1;
    if (tries < JAIL_TRIES) {
      n = clone(n);
      n.jail[id] = tries;
      return endTurn(n, ctx);
    }
    n = pay(n, id, null, BAIL);
    return leaveJail(n, id, sum, ctx);
  }

  const doubles = isDouble ? s.doubles + 1 : 0;
  if (doubles >= 3) {
    return endTurn(sendToJail({ ...n, doubles: 0 }, id), ctx);
  }
  n = { ...n, doubles, repeat: isDouble };
  n = land(step(n, id, sum), id, sum, true);
  return afterAction(n, ctx);
}

/** Enchaîne les étapes : minuteur de tour relancé quand la phase ou l'étape change. */
function settle(prev: PromoteurState, next: PromoteurState, ctx: GameContext): PromoteurState {
  if (next.phase === 'final' || next.phase === 'ready') {
    ctx.cancel(TURN);
    return { ...next, endsAt: 0 };
  }
  if (next.step === prev.step && next.phase === prev.phase) return next;
  ctx.cancel(TURN);
  const ms = next.settings.turnSeconds * 1000;
  if (ms <= 0) return { ...next, endsAt: 0 };
  ctx.schedule(TURN, ms);
  return { ...next, endsAt: ctx.now() + ms };
}

/** Temps écoulé (ou action forcée de l'hôte) : le joueur lance les dés ou laisse la case. */
function autoTurn(s: PromoteurState, ctx: GameContext): PromoteurState {
  if (s.phase === 'roll') return settle(s, rollDice(s, ctx), ctx);
  if (s.phase === 'decide') return settle(s, resolvePending(s, ctx), ctx);
  return s;
}

export const promoteur: GameModule<PromoteurState, PromoteurSettings> = {
  manifest: {
    id: 'promoteur',
    category: 'plateau',
    name: 'Le Promoteur',
    description: 'Achetez des rues, construisez des immeubles et ruinez vos adversaires.',
    icon: '🏙️',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 6,
    durationMin: 45,
    notice: {
      goal: 'Devenir le joueur le plus riche : liquidités, rues et maisons comptent.',
      steps: [
        'À votre tour, lancez les dés sur votre téléphone et avancez sur le plateau.',
        'Sur une rue libre, achetez-la si vous le souhaitez.',
        'Possédez toute une couleur pour construire des maisons, qui font monter les loyers.',
        'Un joueur qui ne peut plus payer fait faillite et sort de la partie.',
      ],
      tips: [
        'Un double relance les dés. Trois doubles de suite vous envoient en prison.',
        'En prison, faites un double pour sortir, payez 50 €, ou attendez trois tentatives.',
      ],
    },
  },

  settingsSchema: promoteurSettingsSchema,
  defaultSettings: promoteurSettingsSchema.parse({}),

  actions: {
    roll: noPayload,
    bail: noPayload,
    buy: noPayload,
    pass: noPayload,
    build: buildSchema,
  },

  initialize(settings, players: PlayerRef[], ctx) {
    const parsed = promoteurSettingsSchema.parse(settings);
    const order = players.map((p) => p.id);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      order,
      cash: Object.fromEntries(order.map((id) => [id, START_CASH])),
      pos: Object.fromEntries(order.map((id) => [id, 0])),
      jail: {},
      bankrupt: [],
      owners: {},
      houses: {},
      current: null,
      round: 1,
      doubles: 0,
      repeat: false,
      dice: null,
      pending: null,
      chanceOrder: shuffle(CHANCE.map((_, i) => i), ctx.random),
      chanceIndex: 0,
      chestOrder: shuffle(CHEST.map((_, i) => i), ctx.random),
      chestIndex: 0,
      lastEvent: 'Le plateau est prêt',
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
      cash: { ...s.cash, [p.id]: START_CASH },
      pos: { ...s.pos, [p.id]: 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const cash = { ...s.cash };
    const pos = { ...s.pos };
    delete players[p.id];
    delete cash[p.id];
    delete pos[p.id];
    return { ...s, players, cash, pos, order: s.order.filter((id) => id !== p.id) };
  },

  start(s, ctx): GameResult<PromoteurState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.order.length < 2) return fail('Il faut au moins deux joueurs');
    const first = s.order[0] ?? null;
    const next = beginRoll({ ...s, current: first, round: 1, doubles: 0, repeat: false, dice: null });
    return ok(settle(s, next, ctx));
  },

  handleAction(s, p, type, payload, ctx): GameResult<PromoteurState> {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (s.phase === 'ready' || s.phase === 'final') return fail('La partie n’est pas en cours');
    if (s.current !== p.id) return fail('Ce n’est pas votre tour');

    let next: PromoteurState;

    if (type === 'roll') {
      if (s.phase !== 'roll') return fail('Vous ne pouvez pas lancer les dés maintenant');
      next = rollDice(s, ctx);
    } else if (type === 'bail') {
      if (s.phase !== 'roll' || s.jail[p.id] === undefined) return fail('Vous n’êtes pas en prison');
      if ((s.cash[p.id] ?? 0) < BAIL) return fail('Argent insuffisant pour payer la caution');
      const paid = pay(s, p.id, null, BAIL);
      const n = clone(paid);
      delete n.jail[p.id];
      n.lastEvent = `${nameOf(n, p.id)} paie la caution et sort de prison`;
      next = bump({ ...n, doubles: 0 });
    } else if (type === 'build') {
      const parsed = buildSchema.safeParse(payload);
      if (!parsed.success) return fail('Case invalide');
      if (s.phase !== 'roll') return fail('Construisez avant de lancer les dés');
      const index = parsed.data.square;
      const error = buildError(s, p.id, index);
      if (error) return fail(error);
      const n = clone(s);
      n.cash[p.id] = (n.cash[p.id] ?? 0) - (squareAt(index).house ?? 0);
      n.houses[key(index)] = (n.houses[key(index)] ?? 0) + 1;
      n.lastEvent = `${nameOf(n, p.id)} construit sur ${squareAt(index).name}`;
      next = n;
    } else if (type === 'buy') {
      if (s.phase !== 'decide' || s.pending === null) return fail('Rien à acheter maintenant');
      const sq = squareAt(s.pending);
      const price = sq.price ?? 0;
      if ((s.cash[p.id] ?? 0) < price) return fail('Argent insuffisant');
      const n = clone(s);
      n.cash[p.id] = (n.cash[p.id] ?? 0) - price;
      n.owners[key(s.pending)] = p.id;
      n.pending = null;
      n.lastEvent = `${nameOf(n, p.id)} achète ${sq.name}`;
      next = resolvePending(n, ctx);
    } else if (type === 'pass') {
      if (s.phase !== 'decide') return fail('Rien à refuser maintenant');
      next = resolvePending({ ...s, lastEvent: `${nameOf(s, p.id)} laisse la case` }, ctx);
    } else {
      return fail('Action inconnue');
    }

    return ok(settle(s, next, ctx));
  },

  onTimer(s, k, ctx) {
    if (k !== TURN) return s;
    return autoTurn(s, ctx);
  },

  nextRound(s, ctx) {
    if (s.phase !== 'roll' && s.phase !== 'decide') return s;
    return autoTurn(s, ctx);
  },

  calculateScores(s) {
    return rankEntries(s.players, worthMap(s));
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const worth = worthMap(s);
    const pendingSquare = s.pending === null ? null : squareAt(s.pending);
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.settings.rounds,
      current: s.current,
      currentName: s.current ? nameOf(s, s.current) : null,
      players: s.order.map((id) => ({
        id,
        name: nameOf(s, id),
        cash: s.cash[id] ?? 0,
        pos: s.pos[id] ?? 0,
        jailed: s.jail[id] !== undefined,
        bankrupt: !isActive(s, id),
        worth: worth[id] ?? 0,
      })),
      board: BOARD.map((sq) => ({
        ...sq,
        owner: s.owners[key(sq.index)] ?? null,
        houses: s.houses[key(sq.index)] ?? 0,
      })),
      dice: s.dice,
      pending: pendingSquare
        ? { index: pendingSquare.index, name: pendingSquare.name, price: pendingSquare.price ?? 0 }
        : null,
      lastEvent: s.lastEvent,
      endsAt: s.endsAt,
      durationMs: s.settings.turnSeconds * 1000,
      ranking: rankEntries(s.players, worth),
    };
  },

  getPlayerState(s, playerId) {
    const mine = s.current === playerId && (s.phase === 'roll' || s.phase === 'decide');
    const cash = s.cash[playerId] ?? 0;
    const jailed = s.jail[playerId] !== undefined;
    const pendingSq = s.pending === null ? null : squareAt(s.pending);
    const worth = worthOf(s, playerId);
    const rank = rankEntries(s.players, worthMap(s)).find((e) => e.playerId === playerId)?.rank ?? null;

    return {
      cash,
      worth,
      rank,
      pos: s.pos[playerId] ?? 0,
      jailed,
      bankrupt: !isActive(s, playerId),
      isMyTurn: mine,
      canRoll: mine && s.phase === 'roll',
      canBail: mine && s.phase === 'roll' && jailed && cash >= BAIL,
      canBuy: mine && s.phase === 'decide' && !!pendingSq && cash >= (pendingSq.price ?? 0),
      pending: mine && pendingSq ? { index: pendingSq.index, name: pendingSq.name, price: pendingSq.price ?? 0 } : null,
      properties: ownedBy(s, playerId)
        .filter((i) => squareAt(i).kind === 'street')
        .map((i) => ({
          index: i,
          name: squareAt(i).name,
          group: squareAt(i).group ?? null,
          houses: s.houses[key(i)] ?? 0,
          canBuild: mine && s.phase === 'roll' && buildError(s, playerId, i) === null,
        })),
    };
  },

  getHostState(s) {
    return { phase: s.phase, currentName: s.current ? nameOf(s, s.current) : null };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.current !== playerId) return null;
    const k = `s${s.step}`;
    if (s.phase === 'roll') {
      if (s.jail[playerId] !== undefined && (s.cash[playerId] ?? 0) >= BAIL && random() < 0.5) {
        return { type: 'bail', key: k };
      }
      return { type: 'roll', key: k };
    }
    if (s.phase === 'decide' && s.pending !== null) {
      const price = squareAt(s.pending).price ?? 0;
      return { type: (s.cash[playerId] ?? 0) - price >= 200 ? 'buy' : 'pass', key: k };
    }
    return null;
  },
};
