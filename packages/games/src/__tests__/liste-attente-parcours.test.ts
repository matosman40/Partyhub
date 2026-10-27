import { describe, expect, it } from 'vitest';
import type { GameModule, PlayerRef } from '@partyhub/shared';
import { gameRegistry } from '../index.js';
import { mulberry32 } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

/**
 * Vérification de la liste « en attente » publique tout au long de parties jouées par des robots :
 * à chaque pas, la vue publique et la vue hôte donnent la même liste, et cette liste ne contient
 * que des joueurs réels, sans doublon.
 */
const GAMES = [
  'quiz-party',
  'phrases-trous',
  'association',
  'plutot-qui',
  'imposteur',
  'plus-ou-moins',
  'micro-defis',
  'gags-en-rafale',
  'funambule',
  'imite-moi',
  'aventure-ia',
];

const MAX_STEPS = 400;

function roster(n: number): PlayerRef[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Joueur${i}` }));
}

function pendingOf(game: GameModule, state: unknown): unknown[] {
  const pub = game.getPublicState(state) as { pending?: unknown };
  const host = game.getHostState(state) as { pending?: unknown };
  return [pub.pending, host.pending];
}

/** Joue une partie complète avec des robots et renvoie le nombre de pas vérifiés. */
function playWithBots(game: GameModule, players: PlayerRef[], seed: number): { steps: number; nonEmpty: number } {
  const h = harness({ random: mulberry32(seed) });
  const names = new Set(players.map((p) => p.name));
  let state = game.initialize(game.defaultSettings, players, h.ctx);
  const started = game.start(state, h.ctx);
  expect(started.ok, `${game.manifest.id} démarrage`).toBe(true);
  if (!started.ok) return { steps: 0, nonEmpty: 0 };
  state = started.state;

  let steps = 0;
  let nonEmpty = 0;
  for (; steps < MAX_STEPS; steps++) {
    const before = JSON.stringify(state);
    const [pub, host] = pendingOf(game, state);
    expect(JSON.stringify(state), `${game.manifest.id} pas ${steps} : les vues ne modifient pas l’état`).toBe(before);
    expect(Array.isArray(pub), `${game.manifest.id} pending public est une liste`).toBe(true);
    expect(pub, `${game.manifest.id} pas ${steps} : public = hôte`).toEqual(host ?? []);
    const list = pub as string[];
    if (list.length > 0) nonEmpty++;
    expect(new Set(list).size, `${game.manifest.id} pas ${steps} : pas de doublon`).toBe(list.length);
    for (const n of list) {
      expect(names.has(n), `${game.manifest.id} pas ${steps} : « ${n} » est un joueur`).toBe(true);
    }
    expect(() => JSON.stringify(game.getPublicState(state))).not.toThrow();

    if (game.isFinished(state)) break;

    let acted = false;
    for (const p of players) {
      const sug = game.suggest?.(state, p.id, h.ctx.random, h.ctx.now());
      if (!sug) continue;
      const r = game.handleAction(state, p, sug.type, sug.payload, h.ctx);
      if (r.ok) {
        state = r.state;
        acted = true;
      }
    }
    // Travail hors moteur (IA) : sans IA, la salle le termine en échec et le moteur prend le relais.
    const job = (state as { job?: { id: string } | null }).job;
    if (!acted && job && game.completeJob) {
      state = game.completeJob(state, job.id, { ok: false, error: 'sans IA (test)' }, h.ctx);
      acted = true;
    }
    if (!acted) {
      const keys = [...h.timers.entries()];
      if (keys.length === 0) break;
      const latest = Math.max(...keys.map(([, at]) => at));
      h.advance(Math.max(0, latest - h.ctx.now()) + 1);
      for (const [key] of keys) state = h.fire(game, state, key);
    }
  }
  return { steps, nonEmpty };
}

describe('liste « en attente » : parties complètes avec robots', () => {
  for (const id of GAMES) {
    it(`${id} : publique = hôte à chaque pas, sur plusieurs parties`, () => {
      const game = gameRegistry.find((g) => g.manifest.id === id) as GameModule | undefined;
      expect(game, id).toBeDefined();
      if (!game) return;
      const count = Math.min(game.manifest.maxPlayers, 6);
      let nonEmpty = 0;
      let steps = 0;
      for (const seed of [3, 11, 29]) {
        const r = playWithBots(game, roster(Math.max(game.manifest.minPlayers, count)), seed);
        nonEmpty += r.nonEmpty;
        steps += r.steps;
      }
      // Garde-fou : la liste a bien été non vide à certains pas, sinon le test ne prouve rien.
      expect(steps, `${id} : des pas joués`).toBeGreaterThan(0);
      expect(nonEmpty, `${id} : liste non vide à au moins un pas`).toBeGreaterThan(0);
    });
  }
});

describe('liste « en attente » : performance de la vue publique', () => {
  it('appel de getPublicState inférieur à 5 ms en moyenne, avec 12 joueurs', () => {
    for (const id of GAMES) {
      const game = gameRegistry.find((g) => g.manifest.id === id) as GameModule | undefined;
      if (!game) continue;
      const players = roster(Math.min(12, Math.max(game.manifest.maxPlayers, game.manifest.minPlayers)));
      const h = harness({ random: mulberry32(7) });
      const init = game.initialize(game.defaultSettings, players, h.ctx);
      const started = game.start(init, h.ctx);
      if (!started.ok) continue;
      const runs = 200;
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) game.getPublicState(started.state);
      const avg = (performance.now() - t0) / runs;
      expect(avg, id).toBeLessThan(5);
    }
  });
});
