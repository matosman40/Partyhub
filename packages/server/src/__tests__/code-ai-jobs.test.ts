import { describe, expect, it } from 'vitest';
import type { GameContext, GameJob } from '@partyhub/shared';
import { PHRASES_JOB_KIND } from '@partyhub/games';
import { CodeGameRuntime, CODE_SERVER_GLOBAL, createCodeModule } from '../packages/code-runtime.js';
import { CODE_JOB_MAX_BYTES, codeJobRunner, hasKnownAiJobs } from '../code-games/ai-jobs.js';
import { Store } from '../db/store.js';

/**
 * Module de jeu de code qui demande un travail d'IA au départ. `completeJob` garde le résultat pour que le test
 * puisse vérifier ce que le jeu a reçu : une valeur (IA), null (repli sans IA) ou une erreur.
 */
const FIXTURE = `
var ${CODE_SERVER_GLOBAL} = (function () {
  var manifest = {
    id: 'jeu-ia', category: 'solo', name: 'Jeu IA', description: 'Test.', icon: 'x',
    version: '1.0.0', apiVersion: 1, minPlayers: 1, maxPlayers: 2, durationMin: 1,
    notice: { goal: 'g', steps: [], tips: [] }
  };
  var game = {
    manifest: manifest,
    settingsSchema: { safeParse: function (v) { return { success: true, data: v }; } },
    defaultSettings: {},
    actions: {},
    initialize: function () {
      return { job: { id: 'j1', kind: 'phrases-themes', input: { themes: [{ name: 'T', keywords: ['k'] }], rounds: 2 } }, result: null };
    },
    onPlayerJoin: function (s) { return s; },
    onPlayerLeave: function (s) { return s; },
    start: function (s) { return { ok: true, state: s }; },
    handleAction: function (s) { return { ok: true, state: s }; },
    onTimer: function (s) { return s; },
    nextRound: function (s) { return s; },
    calculateScores: function () { return []; },
    end: function (s) { return s; },
    getPublicState: function (s) { return { result: s.result }; },
    getPlayerState: function (s) { return { result: s.result }; },
    getHostState: function (s) { return { result: s.result }; },
    isFinished: function (s) { return s.result !== null; },
    pendingJob: function (s) { return s.job; },
    completeJob: function (s, jobId, outcome) {
      if (!s.job || s.job.id !== jobId) return s;
      return { job: null, result: outcome.ok ? (outcome.value === null ? 'repli' : 'ia') : 'erreur: ' + outcome.error };
    }
  };
  return { default: game };
})();
`;

function contexte(): GameContext {
  return { now: () => 0, random: () => 0.5, schedule: () => {}, cancel: () => {}, connectedPlayerIds: () => [] };
}

function travail(input: unknown = { themes: [{ name: 'T', keywords: ['k'] }], rounds: 2 }): GameJob {
  return { id: 'j1', kind: PHRASES_JOB_KIND, input };
}

describe('travaux d’IA des jeux de code', () => {
  it('expose le travail demandé, et le jeu intègre le résultat par completeJob', () => {
    const module = createCodeModule(new CodeGameRuntime(FIXTURE), undefined, async () => null);
    const state = module.initialize({}, [], contexte());
    expect(module.pendingJob?.(state)).toMatchObject({ id: 'j1', kind: PHRASES_JOB_KIND });

    const next = module.completeJob!(state, 'j1', { ok: true, value: { rounds: [] } }, contexte());
    expect(module.getPublicState(next)).toEqual({ result: 'ia' });
    expect(module.pendingJob?.(next)).toBeNull();
  });

  it('un identifiant de travail périmé laisse l’état inchangé', () => {
    const module = createCodeModule(new CodeGameRuntime(FIXTURE), undefined, async () => null);
    const state = module.initialize({}, [], contexte());
    const next = module.completeJob!(state, 'ancien', { ok: true, value: null }, contexte());
    expect(module.pendingJob?.(next)).toMatchObject({ id: 'j1' });
    expect(module.getPublicState(next)).toEqual({ result: null });
  });

  it('sans exécuteur, le travail échoue : le jeu prend son repli au lieu d’attendre', async () => {
    const module = createCodeModule(new CodeGameRuntime(FIXTURE));
    await expect(module.runJob!(travail(), contexte(), new AbortController().signal)).rejects.toThrow(
      'Travail d’IA non disponible',
    );
  });

  it('sans IA activée pour le jeu, le travail est refusé', async () => {
    const run = codeJobRunner('phrases-trous', () => false);
    await expect(run(travail(), contexte(), new AbortController().signal)).rejects.toThrow('pas activée');
  });

  it('un jeu inconnu, ou un type de travail qui ne le concerne pas, est refusé', async () => {
    const signal = new AbortController().signal;
    await expect(codeJobRunner('jeu-inconnu', () => true)(travail(), contexte(), signal)).rejects.toThrow('inconnu');
    const roster: GameJob = { id: 'j1', kind: 'roster', input: {} };
    await expect(codeJobRunner('phrases-trous', () => true)(roster, contexte(), signal)).rejects.toThrow('inconnu');
  });

  it('un travail trop volumineux est refusé avant tout appel', async () => {
    const gros = travail({ themes: [{ name: 'x'.repeat(CODE_JOB_MAX_BYTES), keywords: [] }], rounds: 1 });
    await expect(
      codeJobRunner('phrases-trous', () => true)(gros, contexte(), new AbortController().signal),
    ).rejects.toThrow('trop volumineux');
  });

  it('sans clé du serveur, un travail autorisé renvoie null : le jeu prend son repli, sans erreur', async () => {
    const module = createCodeModule(
      new CodeGameRuntime(FIXTURE),
      undefined,
      codeJobRunner('phrases-trous', () => true),
    );
    const state = module.initialize({}, [], contexte());
    const value = await module.runJob!(travail(), contexte(), new AbortController().signal);
    expect(value).toBeNull();
    const next = module.completeJob!(state, 'j1', { ok: true, value }, contexte());
    expect(module.getPublicState(next)).toEqual({ result: 'repli' });
  });

  it('seuls les jeux intégrés qui ont une IA sont reconnus', () => {
    expect(hasKnownAiJobs('aventure-ia')).toBe(true);
    expect(hasKnownAiJobs('phrases-trous')).toBe(true);
    expect(hasKnownAiJobs('banquise')).toBe(false);
  });

  it('l’activation par jeu se garde et se retire', () => {
    const store = new Store(':memory:');
    expect(store.isAiGameEnabled('phrases-trous')).toBe(false);
    store.setAiGameEnabled('phrases-trous', true);
    store.setAiGameEnabled('aventure-ia', true);
    expect(store.aiGameIds()).toEqual(['aventure-ia', 'phrases-trous']);
    store.setAiGameEnabled('phrases-trous', false);
    expect(store.isAiGameEnabled('phrases-trous')).toBe(false);
    expect(store.isAiGameEnabled('aventure-ia')).toBe(true);
  });
});
