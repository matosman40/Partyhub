import { describe, expect, it } from 'vitest';
import { CodeGameRuntime, CODE_SERVER_GLOBAL, createCodeModule } from '../packages/code-runtime.js';
import { launchCheck } from '../packages/launch-check.js';
import type { GameContext } from '@partyhub/shared';

/**
 * Module de jeu écrit à la main, en JavaScript pur, pour sonder l'isolat : il renvoie ce qu'il voit
 * de l'environnement, et sait boucler ou gonfler sa mémoire sur demande.
 */
const PROBE = `
var ${CODE_SERVER_GLOBAL} = (function () {
  var manifest = {
    id: 'sonde', category: 'solo', name: 'Sonde', description: 'Sonde de test.', icon: 'x',
    version: '1.0.0', apiVersion: 1, minPlayers: 1, maxPlayers: 2, durationMin: 1,
    notice: { goal: 'g', steps: [], tips: [] }
  };
  function view(state) {
    return {
      n: state.n,
      fetch: typeof fetch, process: typeof process, require: typeof require, Deno: typeof Deno,
      XMLHttpRequest: typeof XMLHttpRequest, WebSocket: typeof WebSocket, setTimeout: typeof setTimeout,
      importScripts: typeof importScripts
    };
  }
  var game = {
    manifest: manifest,
    settingsSchema: { safeParse: function (v) { return { success: true, data: v }; } },
    defaultSettings: {},
    actions: {
      boucle: { safeParse: function (p) { return { success: true, data: p }; } },
      memoire: { safeParse: function (p) { return { success: true, data: p }; } },
      avance: {
        safeParse: function (p) {
          return typeof p === 'object' && p !== null && typeof p.pas === 'number'
            ? { success: true, data: p }
            : { success: false, error: { issues: [{ code: 'invalid_type', path: ['pas'], message: 'pas attendu' }] } };
        }
      }
    },
    initialize: function () { return { n: 0 }; },
    onPlayerJoin: function (s) { return s; },
    onPlayerLeave: function (s) { return s; },
    start: function (s) { return { ok: true, state: s }; },
    handleAction: function (s, player, type, payload) {
      if (type === 'boucle') { while (true) {} }
      if (type === 'memoire') { var a = []; while (true) { a.push(new Array(100000).fill(1)); } }
      return { ok: true, state: { n: s.n + payload.pas } };
    },
    onTimer: function (s) { return s; },
    nextRound: function (s) { return s; },
    calculateScores: function () { return []; },
    end: function (s) { return s; },
    getPublicState: view,
    getPlayerState: function (s) { return { n: s.n }; },
    getHostState: function (s) { return { n: s.n }; },
    isFinished: function (s) { return s.n >= 2; }
  };
  return { default: game };
})();
`;

/** Module qui ne se termine jamais et ne propose aucune action : le contrôle doit le refuser. */
const STUCK = `
var ${CODE_SERVER_GLOBAL} = (function () {
  var manifest = {
    id: 'bloque', category: 'solo', name: 'Bloqué', description: 'Ne finit pas.', icon: 'x',
    version: '1.0.0', apiVersion: 1, minPlayers: 1, maxPlayers: 2, durationMin: 1,
    notice: { goal: 'g', steps: [], tips: [] }
  };
  var same = function (s) { return s; };
  return { default: {
    manifest: manifest, settingsSchema: { safeParse: function (v) { return { success: true, data: v }; } },
    defaultSettings: {}, actions: {},
    initialize: function () { return { n: 0 }; }, onPlayerJoin: same, onPlayerLeave: same,
    start: function (s) { return { ok: true, state: s }; },
    handleAction: function (s) { return { ok: true, state: s }; },
    onTimer: same, nextRound: same, calculateScores: function () { return []; }, end: same,
    getPublicState: function () { return {}; }, getPlayerState: function () { return {}; },
    getHostState: function () { return {}; }, isFinished: function () { return false; }
  } };
})();
`;

function ctxOf(random = () => 0.25): GameContext {
  return {
    now: () => 1000,
    schedule: () => undefined,
    cancel: () => undefined,
    random,
    connectedPlayerIds: () => ['a'],
  };
}

describe('jeu de code : isolat V8', () => {
  it('ne donne au jeu ni réseau, ni système de fichiers, ni processus', () => {
    const runtime = new CodeGameRuntime(PROBE, 500);
    try {
      const mod = createCodeModule(runtime);
      const view = mod.getPublicState(mod.initialize({}, [], ctxOf())) as Record<string, string>;
      for (const name of [
        'fetch',
        'process',
        'require',
        'Deno',
        'XMLHttpRequest',
        'WebSocket',
        'setTimeout',
        'importScripts',
      ]) {
        expect(view[name], name).toBe('undefined');
      }
    } finally {
      runtime.dispose();
    }
  });

  it('coupe une boucle infinie, et la salle reste utilisable après', () => {
    const runtime = new CodeGameRuntime(PROBE, 300);
    try {
      const mod = createCodeModule(runtime);
      const ctx = ctxOf();
      const state = mod.initialize({}, [{ id: 'a', name: 'A' }], ctx);
      expect(() => mod.handleAction(state, { id: 'a', name: 'A' }, 'boucle', {}, ctx)).toThrow(/timed out|délai/i);
      // L'état reste celui de l'hôte : l'appel suivant fonctionne et renvoie la même vue.
      expect(mod.getPlayerState(state, 'a')).toEqual({ n: 0 });
    } finally {
      runtime.dispose();
    }
  });

  it('borne la mémoire : un jeu qui la gonfle échoue, sans bloquer le serveur', () => {
    const runtime = new CodeGameRuntime(PROBE, 5000);
    try {
      const mod = createCodeModule(runtime);
      const ctx = ctxOf();
      const state = mod.initialize({}, [{ id: 'a', name: 'A' }], ctx);
      expect(() => mod.handleAction(state, { id: 'a', name: 'A' }, 'memoire', {}, ctx)).toThrow();
    } finally {
      runtime.dispose();
    }
  });

  it('valide les actions et les réglages dans l’isolat, avec les mêmes formes que zod', () => {
    const runtime = new CodeGameRuntime(PROBE, 500);
    try {
      const mod = createCodeModule(runtime);
      expect(mod.actions.avance!.safeParse({ pas: 2 })).toEqual({ success: true, data: { pas: 2 } });
      const refused = mod.actions.avance!.safeParse({});
      expect(refused.success).toBe(false);
      expect((refused as { error: { issues: { path: string[] }[] } }).error.issues[0]!.path).toEqual(['pas']);
    } finally {
      runtime.dispose();
    }
  });

  it('transmet la partie entière : la mise à jour de l’état vient de l’isolat', () => {
    const runtime = new CodeGameRuntime(PROBE, 500);
    try {
      const mod = createCodeModule(runtime);
      const ctx = ctxOf();
      let state = mod.initialize({}, [{ id: 'a', name: 'A' }], ctx);
      const first = mod.handleAction(state, { id: 'a', name: 'A' }, 'avance', { pas: 1 }, ctx);
      expect(first.ok).toBe(true);
      state = (first as { state: unknown }).state;
      expect(mod.isFinished(state)).toBe(false);
      const second = mod.handleAction(state, { id: 'a', name: 'A' }, 'avance', { pas: 1 }, ctx);
      state = (second as { state: unknown }).state;
      expect(mod.isFinished(state)).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('refuse un module qui n’a pas toutes ses méthodes', () => {
    const runtime = new CodeGameRuntime(`var ${CODE_SERVER_GLOBAL} = { default: { manifest: {} } };`, 500);
    try {
      expect(() => createCodeModule(runtime)).toThrow(/Méthodes absentes/);
    } finally {
      runtime.dispose();
    }
  });

  it('refuse un jeu qui ne se termine jamais : le contrôle l’annonce comme bloqué', () => {
    const runtime = new CodeGameRuntime(STUCK, 500);
    try {
      const result = launchCheck(createCodeModule(runtime));
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toContain('bloquée');
    } finally {
      runtime.dispose();
    }
  });
});
