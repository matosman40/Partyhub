import type { GameContext, GameResult, PlayerRef, ProfileDataStore } from '@partyhub/shared';
import { aventureIa, type AventureState } from '../aventure/module.js';

/** Helpers partagés par les tests de l'Aventure IA (ce fichier n'est pas un test). */

/** Générateur déterministe (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Générateur constant : 0,999 donne un d20 de 20, 0,001 donne un 1. */
export const constant = (v: number) => () => v;
export const NAT20 = 0.999;
export const NAT1 = 0.001;

export const A: PlayerRef = { id: 'a', name: 'Ana', profileId: 'p-ana' };
export const B: PlayerRef = { id: 'b', name: 'Léo', profileId: 'p-leo' };
export const C: PlayerRef = { id: 'c', name: 'Max' };
export const PLAYERS: PlayerRef[] = [A, B, C];

export function makeCtx(opts: { random?: () => number; profileData?: ProfileDataStore } = {}): GameContext {
  return {
    now: () => 1_000_000,
    schedule: () => undefined,
    cancel: () => undefined,
    random: opts.random ?? mulberry32(7),
    connectedPlayerIds: () => PLAYERS.map((p) => p.id),
    ...(opts.profileData ? { profileData: opts.profileData } : {}),
  };
}

export function must<T>(r: GameResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

export function act(
  s: AventureState,
  player: PlayerRef,
  type: string,
  payload: unknown,
  ctx: GameContext,
): AventureState {
  return must(aventureIa.handleAction(s, player, type, payload, ctx));
}

/** Répond au travail en attente avec une valeur (null : histoire de secours). */
export function answer(s: AventureState, ctx: GameContext, value: unknown = null): AventureState {
  const job = aventureIa.pendingJob!(s);
  if (!job) throw new Error('aucun travail en attente');
  return aventureIa.completeJob!(s, job.id, { ok: true, value }, ctx);
}

/** Lobby terminé jusqu'au premier choix de personnage : l'histoire de secours est prête. */
export function startGame(
  settings: Record<string, unknown>,
  ctx: GameContext,
  players: PlayerRef[] = PLAYERS,
): AventureState {
  const init = aventureIa.initialize({ ...aventureIa.defaultSettings, ...settings }, players, ctx);
  return answer(must(aventureIa.start(init, ctx)), ctx);
}

/** Chaque joueur prend le personnage c1, c2, c3... dans l'ordre d'arrivée. */
export function pickInOrder(s: AventureState, ctx: GameContext, players: PlayerRef[] = PLAYERS): AventureState {
  let next = s;
  players.forEach((p, i) => {
    next = act(next, p, 'pick', { characterId: `c${i + 1}` }, ctx);
  });
  return next;
}

/** Joue la partie jusqu'à l'épilogue, en faisant jouer les robots (même logique que le test de bout en bout). */
export function playToEnd(start: AventureState, ctx: GameContext, players: PlayerRef[] = PLAYERS): AventureState {
  let s = start;
  for (let guard = 0; guard < 400 && s.phase !== 'final'; guard += 1) {
    if (aventureIa.pendingJob!(s)) {
      s = answer(s, ctx);
      continue;
    }
    if (s.reveal) {
      s = aventureIa.nextRound!(s, ctx);
      continue;
    }
    for (const p of players) {
      const move = aventureIa.suggest!(s, p.id, ctx.random);
      if (move) s = act(s, p, move.type, move.payload, ctx);
    }
    if (s.phase === 'choose' || s.phase === 'vote' || s.phase === 'combat') s = aventureIa.nextRound!(s, ctx);
  }
  return s;
}
