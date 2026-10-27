import { describe, expect, it } from 'vitest';
import type { GameModule, PlayerRef } from '@partyhub/shared';
import { gameRegistry } from '../index.js';
import { mulberry32 } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

/**
 * Vérification de la liste « en attente » publique tout au long de parties jouées par des robots :
 * à chaque pas, la vue publique et la vue hôte donnent la même liste, cette liste ne contient que des
 * joueurs réels (sans doublon), et les vues ne modifient jamais l’état. Couvre les réglages par défaut,
 * les bornes des réglages numériques, les départs et retours de joueurs en cours de partie, et les
 * déconnexions (joueurs présents dans la salle ou non).
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
const SEEDS = [3, 11, 29];

function roster(n: number): PlayerRef[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Joueur${i}` }));
}

/** Réglages par défaut, puis chaque borne numérique (min et max) prise seule, en gardant les autres défauts. */
function settingsVariants(game: GameModule): Record<string, unknown>[] {
  const variants: Record<string, unknown>[] = [{ ...(game.defaultSettings as object) }];
  const shape = (game.settingsSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  for (const [key, raw] of Object.entries(shape)) {
    let node = raw as { _def?: { innerType?: unknown; typeName?: string }; minValue?: number; maxValue?: number };
    while (node && node._def?.innerType) node = node._def.innerType as typeof node;
    const { minValue, maxValue } = node ?? {};
    for (const bound of [minValue, maxValue]) {
      if (typeof bound !== 'number') continue;
      variants.push({ ...(game.defaultSettings as object), [key]: bound });
    }
  }
  return variants;
}

function fail(id: string, step: number, what: string): string {
  return `${id} pas ${step} : ${what}`;
}

interface Run {
  steps: number;
  nonEmpty: number;
  churn: number;
}

/**
 * Joue une partie avec des robots. `churn` : départs et retours de joueurs à intervalles réguliers,
 * et déconnexions (le joueur reste dans la partie mais n’est plus dans la salle).
 */
function playWithBots(game: GameModule, players: PlayerRef[], settings: unknown, seed: number, churn: boolean): Run {
  const id = game.manifest.id;
  const h = harness({ random: mulberry32(seed) });
  const rand = mulberry32(seed + 101);
  const names = new Set(players.map((p) => p.name));
  const run: Run = { steps: 0, nonEmpty: 0, churn: 0 };

  let state = game.initialize(settings as never, players, h.ctx);
  const started = game.start(state, h.ctx);
  expect(started.ok, `${id} démarrage ${JSON.stringify(settings)}`).toBe(true);
  if (!started.ok) return run;
  state = started.state;

  const away = new Set<string>();
  for (; run.steps < MAX_STEPS; run.steps++) {
    const step = run.steps;
    const before = JSON.stringify(state);
    const pub = game.getPublicState(state) as { pending?: unknown };
    const host = game.getHostState(state) as { pending?: unknown };
    expect(JSON.stringify(state), fail(id, step, 'les vues ne modifient pas l’état')).toBe(before);
    expect(Array.isArray(pub.pending), fail(id, step, 'pending public est une liste')).toBe(true);
    expect(pub.pending, fail(id, step, 'public = hôte')).toEqual(host.pending ?? []);
    const list = pub.pending as string[];
    if (list.length > 0) run.nonEmpty++;
    expect(new Set(list).size, fail(id, step, 'pas de doublon')).toBe(list.length);
    for (const n of list) expect(names.has(n), fail(id, step, `« ${n} » est un joueur connu`)).toBe(true);
    expect(() => JSON.stringify(game.getPublicState(state)), fail(id, step, 'sérialisable')).not.toThrow();

    if (game.isFinished(state)) break;

    if (churn && step % 5 === 4) {
      const p = players[Math.floor(rand() * players.length)]!;
      if (away.has(p.id)) {
        // Retour : le joueur revient dans la salle.
        away.delete(p.id);
        h.connected.push(p.id);
        state = game.onPlayerJoin(state, p, h.ctx);
      } else {
        // Départ : retiré de la salle, puis de la partie.
        away.add(p.id);
        const i = h.connected.indexOf(p.id);
        if (i >= 0) h.connected.splice(i, 1);
        state = game.onPlayerLeave(state, p, h.ctx);
      }
      run.churn++;
      continue;
    }

    let acted = false;
    for (const p of players) {
      if (away.has(p.id)) continue;
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
      const timers = [...h.timers.entries()];
      if (timers.length === 0) break;
      const latest = Math.max(...timers.map(([, at]) => at));
      h.advance(Math.max(0, latest - h.ctx.now()) + 1);
      for (const [key] of timers) state = h.fire(game, state, key);
    }
  }
  return run;
}

function selectGames(): GameModule[] {
  return GAMES.map((id) => {
    const game = gameRegistry.find((g) => g.manifest.id === id) as GameModule | undefined;
    if (!game) throw new Error(`jeu introuvable : ${id}`);
    return game;
  });
}

describe('liste « en attente » : parties complètes avec robots', () => {
  for (const game of selectGames()) {
    const id = game.manifest.id;
    it(`${id} : réglages par défaut et bornes, partie complète, à chaque pas`, () => {
      const count = Math.max(game.manifest.minPlayers, Math.min(game.manifest.maxPlayers, 6));
      let nonEmpty = 0;
      let steps = 0;
      for (const settings of settingsVariants(game)) {
        const parsed = game.settingsSchema.safeParse(settings);
        expect(parsed.success, `${id} réglages valides ${JSON.stringify(settings)}`).toBe(true);
        for (const seed of SEEDS) {
          const r = playWithBots(game, roster(count), parsed.success ? parsed.data : settings, seed, false);
          nonEmpty += r.nonEmpty;
          steps += r.steps;
        }
      }
      expect(steps, `${id} : des pas joués`).toBeGreaterThan(0);
      expect(nonEmpty, `${id} : liste non vide à au moins un pas`).toBeGreaterThan(0);
    });

    it(`${id} : départs, retours et déconnexions en cours de partie`, () => {
      const min = game.manifest.minPlayers;
      const max = Math.min(game.manifest.maxPlayers, 8);
      let nonEmpty = 0;
      let churn = 0;
      for (const n of [min, max]) {
        for (const seed of SEEDS) {
          const r = playWithBots(game, roster(n), game.defaultSettings, seed, true);
          nonEmpty += r.nonEmpty;
          churn += r.churn;
        }
      }
      expect(churn, `${id} : départs/retours joués`).toBeGreaterThan(0);
      expect(nonEmpty, `${id} : liste non vide à au moins un pas`).toBeGreaterThan(0);
    });
  }
});

describe('liste « en attente » : performance de la vue publique', () => {
  it('appel de getPublicState inférieur à 5 ms en moyenne, avec 12 joueurs', () => {
    for (const game of selectGames()) {
      const players = roster(Math.min(12, Math.max(game.manifest.maxPlayers, game.manifest.minPlayers)));
      const h = harness({ random: mulberry32(7) });
      const started = game.start(game.initialize(game.defaultSettings, players, h.ctx), h.ctx);
      if (!started.ok) continue;
      const runs = 200;
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) game.getPublicState(started.state);
      const avg = (performance.now() - t0) / runs;
      expect(avg, game.manifest.id).toBeLessThan(5);
    }
  });
});
