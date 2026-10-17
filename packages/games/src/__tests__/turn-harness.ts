import type { AiClient, GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { PLAYERS, mulberry32, must } from './aventure-helpers.js';

/**
 * Banc d'essai pour les jeux à tours et à minuteurs : horloge réglable, minuteurs enregistrés (on peut les
 * déclencher à la main), joueurs connectés modifiables, et un faux client d'IA. Ce fichier n'est pas un test.
 */

export interface Harness {
  ctx: GameContext;
  /** Minuteurs armés : clé -> instant d'échéance. */
  timers: Map<string, number>;
  connected: string[];
  advance(ms: number): void;
  /** Déclenche un minuteur armé et renvoie l'état suivant. */
  fire<S>(game: GameModule<S, unknown>, state: S, key: string): S;
}

export function harness(opts: { connected?: string[]; random?: () => number; ai?: AiClient } = {}): Harness {
  let now = 1_000_000;
  const timers = new Map<string, number>();
  const connected = opts.connected ?? PLAYERS.map((p) => p.id);
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => {
      timers.set(key, now + ms);
    },
    cancel: (key) => {
      timers.delete(key);
    },
    random: opts.random ?? mulberry32(11),
    connectedPlayerIds: () => [...connected],
    ...(opts.ai ? { ai: opts.ai } : {}),
  };
  return {
    ctx,
    timers,
    connected,
    advance(ms) {
      now += ms;
    },
    fire(game, state, key) {
      timers.delete(key);
      return game.onTimer(state, key, ctx);
    },
  };
}

/** Faux fournisseur d'IA : renvoie la réponse donnée, ou lève l'erreur donnée. */
export function fakeAi(reply: string | Error, available = true): AiClient {
  return {
    available: () => available,
    complete: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

export const PLAYER_LIST: PlayerRef[] = PLAYERS;

export { must };
