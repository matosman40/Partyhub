import { describe, expect, it } from 'vitest';
import type { AiClient, GameContext, GameJob, GameResult, PlayerRef } from '@partyhub/shared';
import { aventureIa, normalizeStats, type AventureState } from '../aventure/module.js';
import { buildPrompt, parseJsonObject, runAventureJob, type JobInput } from '../aventure/ai.js';
import { FALLBACK_SCENES, fallbackRoster, fallbackScene } from '../aventure/fallback.js';
import { aventureSettingsSchema, type SceneDraft } from '../aventure/schemas.js';

/** Générateur déterministe (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const A: PlayerRef = { id: 'a', name: 'Ana' };
const B: PlayerRef = { id: 'b', name: 'Léo' };
const C: PlayerRef = { id: 'c', name: 'Max' };
const PLAYERS = [A, B, C];

function makeCtx(opts: { random?: () => number; connected?: string[]; ai?: AiClient } = {}) {
  const timers = new Map<string, number>();
  let now = 1_000_000;
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: opts.random ?? mulberry32(7),
    connectedPlayerIds: () => opts.connected ?? PLAYERS.map((p) => p.id),
    ...(opts.ai ? { ai: opts.ai } : {}),
  };
  return { ctx, timers, advance: (ms: number) => void (now += ms) };
}

function must<T>(r: GameResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function act(s: AventureState, player: PlayerRef, type: string, payload: unknown, ctx: GameContext): AventureState {
  return must(aventureIa.handleAction(s, player, type, payload, ctx));
}

/** Termine le travail en attente avec une valeur (null : histoire de secours). */
function finishJob(s: AventureState, value: unknown, ctx: GameContext): AventureState {
  const job = aventureIa.pendingJob!(s);
  if (!job) throw new Error('aucun travail en attente');
  return aventureIa.completeJob!(s, job.id, { ok: true, value }, ctx);
}

function started(scenes = 6, ctx = makeCtx().ctx): AventureState {
  const init = aventureIa.initialize({ ...aventureIa.defaultSettings, scenes }, PLAYERS, ctx);
  return finishJob(must(aventureIa.start(init, ctx)), null, ctx);
}

/** Lobby terminé jusqu'au choix : chacun a pris un personnage, la première scène est demandée. */
function inVote(random: () => number, scenes = 6) {
  const { ctx, timers } = makeCtx({ random });
  let s = started(scenes, ctx);
  s = act(s, A, 'pick', { characterId: 'c1' }, ctx);
  s = act(s, B, 'pick', { characterId: 'c2' }, ctx);
  s = act(s, C, 'pick', { characterId: 'c3' }, ctx);
  s = finishJob(s, null, ctx);
  return { s, ctx, timers };
}

describe('réglages', () => {
  it('bornes et valeurs par défaut', () => {
    expect(aventureIa.defaultSettings.scenes).toBe(6);
    expect(aventureSettingsSchema.safeParse({ scenes: 2 }).success).toBe(false);
    expect(aventureSettingsSchema.safeParse({ scenes: 11 }).success).toBe(false);
    expect(aventureSettingsSchema.safeParse({ tone: 'horreur' }).success).toBe(false);
    expect(aventureSettingsSchema.safeParse({ voteSeconds: 10 }).success).toBe(false);
    expect(aventureSettingsSchema.safeParse({ theme: 'x'.repeat(121) }).success).toBe(false);
  });

  it('normalizeStats ramène la somme entre 10 et 14, et garde chaque stat entre 1 et 6', () => {
    const low = normalizeStats({ force: 1, ruse: 1, esprit: 1, charme: 1 });
    const high = normalizeStats({ force: 6, ruse: 6, esprit: 6, charme: 6 });
    expect(Object.values(low).reduce((a, b) => a + b, 0)).toBe(10);
    expect(Object.values(high).reduce((a, b) => a + b, 0)).toBe(14);
    for (const v of [...Object.values(low), ...Object.values(high)]) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

describe('génération', () => {
  it('start demande le monde et les personnages, en préparation', () => {
    const { ctx } = makeCtx();
    const init = aventureIa.initialize(aventureIa.defaultSettings, PLAYERS, ctx);
    const s = must(aventureIa.start(init, ctx));
    expect(s.phase).toBe('preparing');
    expect(aventureIa.pendingJob!(s)?.kind).toBe('roster');
  });

  it('sans IA, l’histoire de secours prend le relais : six personnages, libres, mode secours', () => {
    const { ctx, timers } = makeCtx();
    const s = started(6, ctx);
    expect(s.phase).toBe('choose');
    expect(s.mode).toBe('secours');
    expect(s.characters).toHaveLength(6);
    expect(s.characters.every((c) => c.ownerId === null && c.pv === c.pvMax)).toBe(true);
    expect(timers.has('choose-timeout')).toBe(true);
  });

  it('une réponse IA valide est acceptée, et une réponse hors format est refusée', async () => {
    const roster = fallbackRoster(mulberry32(1));
    const job: GameJob = { id: 'job-1', kind: 'roster', input: { kind: 'roster', theme: '', tone: 'humour' } };
    const signal = new AbortController().signal;

    const { ctx: noAi } = makeCtx();
    expect(await runAventureJob(job, noAi, signal)).toBeNull();

    const good = makeCtx({ ai: { complete: async () => `Voici :\n${JSON.stringify(roster)}` } });
    expect(await runAventureJob(job, good.ctx, signal)).toMatchObject({ world: { title: roster.world.title } });

    const bad = makeCtx({ ai: { complete: async () => '{"world":3}' } });
    await expect(runAventureJob(job, bad.ctx, signal)).rejects.toThrow('hors format');

    const noJson = makeCtx({ ai: { complete: async () => 'texte libre sans accolades' } });
    await expect(runAventureJob(job, noJson.ctx, signal)).rejects.toThrow('sans objet JSON');
  });

  it('le prompt transmis contient le thème, le ton et le signal d’annulation', async () => {
    const seen: { system: string; user: string; signal?: AbortSignal }[] = [];
    const ai: AiClient = {
      complete: async (req) => {
        seen.push(req);
        return JSON.stringify(fallbackRoster(mulberry32(2)));
      },
    };
    const { ctx } = makeCtx({ ai });
    const controller = new AbortController();
    const job: GameJob = {
      id: 'job-1',
      kind: 'roster',
      input: { kind: 'roster', theme: 'un château hanté', tone: 'mystere' },
    };
    await runAventureJob(job, ctx, controller.signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.user).toContain('un château hanté');
    expect(seen[0]!.user).toContain('Mystère et intrigue');
    expect(seen[0]!.system).toContain('JSON');
    expect(seen[0]!.signal).toBe(controller.signal);
  });

  it('parseJsonObject accepte un objet entouré de texte et ne recopie pas la réponse dans l’erreur', () => {
    expect(parseJsonObject('Voici : {"a":1} merci')).toEqual({ a: 1 });
    expect(() => parseJsonObject('rien')).toThrow('sans objet JSON');
    try {
      parseJsonObject('{ secret ');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret');
    }
  });

  it('le prompt de scène signale les personnages à terre, les compagnons et la dernière scène', () => {
    const { ctx } = makeCtx();
    const s = started(6, ctx);
    const characters = s.characters.map((c, i) => ({
      name: c.name,
      title: c.title,
      pv: i === 0 ? 0 : c.pv,
      pvMax: c.pvMax,
      ko: i === 0,
      companion: i > 2,
      stats: c.stats,
      ability: c.ability,
      flaw: c.flaw,
      item: c.item,
    }));
    const input: JobInput = {
      kind: 'scene',
      world: { title: 'Monde', intro: 'Intro' },
      characters,
      history: [],
      sceneNumber: 6,
      total: 6,
    };
    const { user } = buildPrompt(input);
    expect(user).toContain('à terre');
    expect(user).toContain('compagnon, il ne vote pas');
    expect(user).toContain('dernière');
  });

  it('l’histoire de secours évite les scènes déjà jouées quand la réserve le permet', () => {
    const used = FALLBACK_SCENES.slice(0, FALLBACK_SCENES.length - 1).map((s) => s.title);
    const last = fallbackScene(mulberry32(3), used);
    expect(last.title).toBe(FALLBACK_SCENES[FALLBACK_SCENES.length - 1]!.title);
  });
});

describe('personnages', () => {
  it('un personnage déjà pris est refusé ; un joueur peut changer pour un personnage libre', () => {
    const { ctx } = makeCtx();
    let s = started(6, ctx);
    s = act(s, A, 'pick', { characterId: 'c1' }, ctx);
    expect(aventureIa.handleAction(s, B, 'pick', { characterId: 'c1' }, ctx)).toEqual({
      ok: false,
      error: 'Ce personnage est déjà pris',
    });
    s = act(s, A, 'pick', { characterId: 'c2' }, ctx);
    expect(s.characters.find((c) => c.id === 'c1')!.ownerId).toBeNull();
    expect(s.characters.find((c) => c.id === 'c2')!.ownerId).toBe('a');
  });

  it('au bout du temps, les joueurs sans personnage reçoivent un personnage libre', () => {
    const { ctx } = makeCtx();
    let s = started(6, ctx);
    s = act(s, A, 'pick', { characterId: 'c1' }, ctx);
    s = act(s, B, 'pick', { characterId: 'c2' }, ctx);
    s = aventureIa.onTimer(s, 'choose-timeout', ctx);
    expect(s.phase).toBe('preparing');
    const owners = s.characters.filter((c) => c.ownerId !== null).map((c) => c.ownerId);
    expect(owners.sort()).toEqual(['a', 'b', 'c']);
  });

  it('la régénération n’est possible qu’avant le premier choix', () => {
    const { ctx } = makeCtx();
    let s = started(6, ctx);
    const again = must(aventureIa.handleHostAction!(s, 'regenerate', {}, ctx));
    expect(again.phase).toBe('preparing');
    expect(aventureIa.pendingJob!(again)?.kind).toBe('roster');

    s = finishJob(again, null, ctx);
    s = act(s, A, 'pick', { characterId: 'c1' }, ctx);
    expect(aventureIa.handleHostAction!(s, 'regenerate', {}, ctx)).toEqual({
      ok: false,
      error: 'Un joueur a déjà choisi son personnage : impossible de régénérer',
    });
  });
});

describe('scènes et votes', () => {
  it('un vote unanime avec un d20 de 20 est une réussite : xp pour le personnage du premier voteur', () => {
    const { s: start, ctx } = inVote(() => 0.99);
    let s = start;
    s = act(s, A, 'vote', { choiceId: 'o1' }, ctx);
    s = act(s, B, 'vote', { choiceId: 'o1' }, ctx);
    s = act(s, C, 'vote', { choiceId: 'o1' }, ctx);
    const r = s.resolution!;
    expect(r.roll).toBe(20);
    expect(r.success).toBe(true);
    expect(r.characterId).toBe('c1');
    expect(s.characters.find((c) => c.id === 'c1')!.xp).toBe(10);
    expect(s.history).toHaveLength(1);
  });

  it('un d20 de 1 est un échec : le personnage perd 2 PV', () => {
    const { s: start, ctx } = inVote(() => 0);
    let s = start;
    s = act(s, A, 'vote', { choiceId: 'o2' }, ctx);
    s = act(s, B, 'vote', { choiceId: 'o2' }, ctx);
    s = act(s, C, 'vote', { choiceId: 'o2' }, ctx);
    expect(s.resolution!.roll).toBe(1);
    expect(s.resolution!.success).toBe(false);
    const c1 = s.characters.find((c) => c.id === 'c1')!;
    expect(c1.pv).toBe(c1.pvMax - 2);
    expect(c1.xp).toBe(0);
  });

  it('les voix restent secrètes : ni la vue publique ni la vue d’un autre joueur ne les révèlent', () => {
    const { s: start, ctx } = inVote(() => 0.5);
    const s = act(start, A, 'vote', { choiceId: 'o3' }, ctx);
    expect(JSON.stringify(aventureIa.getPublicState(s))).not.toContain('"votes"');
    expect(aventureIa.getPublicState(s)).toMatchObject({ voteCount: 1 });
    expect(aventureIa.getPlayerState(s, 'b')).toMatchObject({ myVote: null, canVote: true });
    expect(aventureIa.getPlayerState(s, 'a')).toMatchObject({ myVote: 'o3', hasVoted: true, canVote: false });
  });

  it('un personnage à terre ne peut plus voter', () => {
    const { s: start, ctx } = inVote(() => 0.5);
    const s = { ...start, characters: start.characters.map((c) => (c.id === 'c2' ? { ...c, pv: 0 } : c)) };
    expect(aventureIa.handleAction(s, B, 'vote', { choiceId: 'o1' }, ctx)).toEqual({
      ok: false,
      error: 'Votre personnage est à terre : vous suivez la suite en spectateur',
    });
  });

  it('une voix sur un choix inconnu est refusée', () => {
    const { s, ctx } = inVote(() => 0.5);
    expect(aventureIa.handleAction(s, A, 'vote', { choiceId: 'o9' }, ctx)).toEqual({
      ok: false,
      error: 'Choix inconnu',
    });
  });

  it('le minuteur de vote résout avec les voix reçues, sans voix : choix au hasard', () => {
    const { s: start, ctx } = inVote(() => 0.5);
    const s = aventureIa.onTimer(start, 'vote-timeout', ctx);
    expect(s.resolution).not.toBeNull();
    expect(s.resolution!.votes).toBe(0);
    expect(s.phase).toBe('preparing');
  });

  it('la scène suivante attend la fin de la révélation du jet, le résultat reste affiché', () => {
    const { s: start, ctx, timers } = inVote(() => 0.99);
    let s = act(start, A, 'vote', { choiceId: 'o1' }, ctx);
    s = act(s, B, 'vote', { choiceId: 'o1' }, ctx);
    s = act(s, C, 'vote', { choiceId: 'o1' }, ctx);
    expect(s.reveal).toBe(true);
    expect(timers.get('reveal-timeout')).toBe(5000);

    // Le texte de la scène suivante arrive pendant la révélation : il attend sans effacer le jet.
    const next: SceneDraft = {
      title: 'Scène attendue',
      text: 'Un couloir qui n’en finit pas.',
      choices: [
        { label: 'Avancer', stat: 'force', difficulty: 10 },
        { label: 'Reculer', stat: 'ruse', difficulty: 10 },
      ],
    };
    s = finishJob(s, next, ctx);
    expect(s.phase).toBe('preparing');
    expect(s.scene).toBeNull();
    expect(s.queued?.kind).toBe('scene');
    expect(aventureIa.getPublicState(s)).toMatchObject({ reveal: true, preparing: 'scene' });
    expect(aventureIa.getPublicState(s).resolution).toEqual(s.resolution);

    // Fin de la révélation : la scène attendue s'affiche aussitôt.
    s = aventureIa.onTimer(s, 'reveal-timeout', ctx);
    expect(s.phase).toBe('vote');
    expect(s.scene?.title).toBe('Scène attendue');
    expect(s.reveal).toBe(false);
    expect(s.queued).toBeNull();
  });
});

describe('aventure complète', () => {
  it('trois scènes réussies : scènes distinctes, épilogue de victoire et classement par XP', () => {
    const { ctx } = makeCtx({ random: () => 0.99 });
    let s = started(3, ctx);
    s = act(s, A, 'pick', { characterId: 'c1' }, ctx);
    s = act(s, B, 'pick', { characterId: 'c2' }, ctx);
    s = act(s, C, 'pick', { characterId: 'c3' }, ctx);

    for (let scene = 1; scene <= 3; scene++) {
      s = finishJob(s, null, ctx);
      expect(s.phase).toBe('vote');
      s = act(s, A, 'vote', { choiceId: 'o1' }, ctx);
      s = act(s, B, 'vote', { choiceId: 'o1' }, ctx);
      s = act(s, C, 'vote', { choiceId: 'o1' }, ctx);
      // Le jet reste affiché quelques secondes, puis la suite prend place.
      s = aventureIa.onTimer(s, 'reveal-timeout', ctx);
    }

    expect(s.phase).toBe('preparing');
    s = finishJob(s, null, ctx);
    expect(s.phase).toBe('final');
    expect(s.victory).toBe(true);
    expect(s.epilogue).not.toBeNull();
    expect(aventureIa.isFinished(s)).toBe(true);
    expect(new Set(s.history.map((h) => h.sceneTitle)).size).toBe(3);

    const ranking = aventureIa.calculateScores(s);
    expect(ranking[0]).toMatchObject({ playerId: 'a', points: 50, rank: 1 });
    expect(ranking.find((e) => e.playerId === 'b')!.points).toBe(20);
  });

  it('toutes les fiches à terre : épilogue de défaite', () => {
    const { s: start, ctx } = inVote(() => 0);
    // Seul le personnage de Ana reste debout, avec 2 PV : un échec le met à terre.
    let s = {
      ...start,
      characters: start.characters.map((c) => (c.id === 'c1' ? { ...c, pv: 2 } : { ...c, pv: 0 })),
    };
    s = act(s, A, 'vote', { choiceId: 'o1' }, ctx);
    expect(s.phase).toBe('preparing');
    s = finishJob(s, null, ctx);
    // L'épilogue attend la fin de la révélation du jet.
    expect(s.phase).toBe('preparing');
    s = aventureIa.onTimer(s, 'reveal-timeout', ctx);
    expect(s.phase).toBe('final');
    expect(s.victory).toBe(false);
  });

  it('l’arrêt par l’hôte termine la partie sans épilogue', () => {
    const { s: start, ctx } = inVote(() => 0.5);
    const s = aventureIa.end(start, ctx);
    expect(s.phase).toBe('final');
    expect(s.epilogue).toBeNull();
    expect(s.job).toBeNull();
  });

  it('un résultat tardif d’un travail déjà remplacé ne change rien', () => {
    const { ctx } = makeCtx();
    const s = started(6, ctx);
    const stale = aventureIa.completeJob!(s, 'job-999', { ok: true, value: null }, ctx);
    expect(stale).toBe(s);
  });
});

describe('robots', () => {
  it('un robot choisit un personnage libre, puis vote pour un choix valide', () => {
    const { ctx } = makeCtx();
    let s = started(6, ctx);
    const pick = aventureIa.suggest!(s, 'a', mulberry32(4));
    expect(pick).toMatchObject({ type: 'pick' });
    s = act(s, A, pick!.type, pick!.payload, ctx);

    s = act(s, B, 'pick', { characterId: 'c2' }, ctx);
    s = act(s, C, 'pick', { characterId: 'c3' }, ctx);
    s = finishJob(s, null, ctx);

    const vote = aventureIa.suggest!(s, 'b', mulberry32(5));
    expect(vote?.type).toBe('vote');
    expect(s.scene!.choices.some((c) => c.id === (vote!.payload as { choiceId: string }).choiceId)).toBe(true);
    expect(aventureIa.suggest!(s, 'a', mulberry32(5))).toMatchObject({ type: 'vote' });
  });
});

describe('contrat du module', () => {
  it('chaque action a un schéma et la vue joueur ne fuit pas les données des autres', () => {
    expect(Object.keys(aventureIa.actions).sort()).toEqual(['pick', 'vote']);
    const { ctx } = makeCtx();
    const s = started(6, ctx);
    const view = aventureIa.getPlayerState(s, 'a');
    expect(JSON.stringify(view)).not.toContain('"b"');
  });
});

describe('file de travaux', () => {
  it('le travail en attente est stable jusqu’à son achèvement', () => {
    const { ctx } = makeCtx();
    const init = aventureIa.initialize(aventureIa.defaultSettings, PLAYERS, ctx);
    const s = must(aventureIa.start(init, ctx));
    expect(aventureIa.pendingJob!(s)).toEqual(aventureIa.pendingJob!(s));
    const done = finishJob(s, null, ctx);
    expect(aventureIa.pendingJob!(done)).toBeNull();
  });

  it('les minuteurs de vote et de choix sont annulés à la fin', () => {
    const { s: start, ctx, timers } = inVote(() => 0.5);
    expect(timers.has('vote-timeout')).toBe(true);
    aventureIa.end(start, ctx);
    expect(timers.has('vote-timeout')).toBe(false);
  });
});
