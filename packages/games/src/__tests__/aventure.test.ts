import { describe, expect, it } from 'vitest';
import type { AiClient, GameContext, GameJob, GameResult, PlayerRef } from '@partyhub/shared';
import { aventureIa, normalizeStats, type AventureState } from '../aventure/module.js';
import { buildPrompt, parseJsonObject, runAventureJob, type JobInput } from '../aventure/ai.js';
import {
  FALLBACK_ARCS,
  FALLBACK_SCENE_PICKS,
  FALLBACK_SCENES,
  fallbackRoster,
  fallbackScene,
} from '../aventure/fallback.js';
import { MAX_ROUNDS, resolveRound, pickAction } from '../aventure/combat.js';
import { aventureSettingsSchema, sceneDraftSchema } from '../aventure/schemas.js';
import type { SceneSeed } from '../aventure/fallback-arc.js';
import type { Character, Combat } from '../aventure/types.js';

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

/** Générateur constant : 0,999 donne un d20 de 20, 0,05 donne un 2, 0,001 donne un 1. */
const constant = (v: number) => () => v;
const NAT20 = 0.999;
const NAT1 = 0.001;
const LOW = 0.1;

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

function started(scenes = 4, ctx = makeCtx().ctx): AventureState {
  const init = aventureIa.initialize({ ...aventureIa.defaultSettings, scenes }, PLAYERS, ctx);
  return finishJob(must(aventureIa.start(init, ctx)), null, ctx);
}

/** Lobby terminé jusqu'au choix : chacun a pris un personnage, la première scène est demandée. */
function picked(scenes = 4, random = mulberry32(7)) {
  const { ctx, timers, advance } = makeCtx({ random });
  let s = started(scenes, ctx);
  for (const [i, p] of PLAYERS.entries()) s = act(s, p, 'pick', { characterId: `c${i + 1}` }, ctx);
  return { s, ctx, timers, advance };
}

/** Équipe prête, scène demandée et pas encore reçue : le test fournit la scène (vote ou affrontement). */
function inVote(random = mulberry32(7), scenes = 4) {
  return picked(scenes, random);
}

/** Une scène d'affrontement, écrite comme le ferait l'IA. */
function fightScene(hp = 10, defense = 10, damage = 2): SceneSeed {
  return {
    title: 'La porte gardée',
    text: 'Une statue bloque le passage et s’anime.',
    enemy: {
      name: 'Statue',
      title: 'Gardienne de pierre',
      emoji: '🗿',
      intro: 'La statue lève son bras.',
      hp,
      defense,
      damage,
      onVictory: 'La statue tombe en poussière.',
    },
    choices: [],
  };
}

function voteScene(): SceneSeed {
  return {
    title: 'Le pont',
    text: 'Un pont tremble au-dessus du vide.',
    choices: [
      { label: 'Traverser', stat: 'force', difficulty: 10, onSuccess: 'Vous passez.', onFailure: 'Vous glissez.' },
      {
        label: 'Chercher un passage',
        stat: 'ruse',
        difficulty: 12,
        onSuccess: 'Un passage.',
        onFailure: 'Une impasse.',
      },
    ],
  };
}

describe('réglages', () => {
  it('bornes et valeurs par défaut : parties courtes', () => {
    expect(aventureSettingsSchema.parse({})).toMatchObject({ scenes: 4, voteSeconds: 30 });
    expect(aventureSettingsSchema.safeParse({ scenes: 2 }).success).toBe(false);
    expect(aventureSettingsSchema.safeParse({ scenes: 7 }).success).toBe(false);
    expect(aventureSettingsSchema.safeParse({ voteSeconds: 10 }).success).toBe(false);
  });

  it('normalizeStats ramène la somme entre 10 et 14, et garde chaque stat entre 1 et 6', () => {
    const low = normalizeStats({ force: 1, ruse: 1, esprit: 1, charme: 1 });
    expect(Object.values(low).reduce((a, b) => a + b, 0)).toBe(10);
    const high = normalizeStats({ force: 6, ruse: 6, esprit: 6, charme: 6 });
    expect(Object.values(high).reduce((a, b) => a + b, 0)).toBe(14);
    expect(Object.values(high).every((v) => v >= 1 && v <= 6)).toBe(true);
  });
});

describe('génération', () => {
  it('start demande le monde, avec son objectif et son secret, en préparation', () => {
    const { ctx } = makeCtx();
    const init = aventureIa.initialize(aventureIa.defaultSettings, PLAYERS, ctx);
    const s = must(aventureIa.start(init, ctx));
    expect(s.phase).toBe('preparing');
    expect(aventureIa.pendingJob!(s)?.kind).toBe('roster');
  });

  it('sans IA, l’histoire de secours fournit une intrigue complète : objectif, secret, personnages secondaires', () => {
    const s = started();
    expect(s.phase).toBe('choose');
    expect(s.mode).toBe('secours');
    expect(s.arc).not.toBeNull();
    expect(s.characters).toHaveLength(6);
    expect(s.world?.goal).toBeTruthy();
    expect(s.world?.secret).toBeTruthy();
    expect(s.npcs.length).toBeGreaterThanOrEqual(2);
  });

  it('une réponse IA valide donne un monde sans intrigue de secours', () => {
    const { ctx } = makeCtx();
    const draft = fallbackRoster(mulberry32(3)).roster;
    const s = finishJob(
      must(aventureIa.start(aventureIa.initialize(aventureIa.defaultSettings, PLAYERS, ctx), ctx)),
      draft,
      ctx,
    );
    expect(s.mode).toBe('ia');
    expect(s.arc).toBeNull();
    expect(s.world?.title).toBe(draft.world.title);
  });

  it('une scène sans choix ni affrontement est refusée, un affrontement seul est accepté', () => {
    expect(sceneDraftSchema.safeParse({ title: 'x', text: 'y', choices: [] }).success).toBe(false);
    expect(sceneDraftSchema.safeParse({ title: 'x', text: 'y', choices: [voteScene().choices[0]] }).success).toBe(
      false,
    );
    expect(sceneDraftSchema.safeParse(fightScene()).success).toBe(true);
    expect(sceneDraftSchema.safeParse(voteScene()).success).toBe(true);
  });

  it('une réponse hors format déclenche une erreur, que le moteur remplace par l’histoire de secours', async () => {
    const ai: AiClient = { complete: async () => '{"title":"seul"}' };
    const input: JobInput = {
      kind: 'scene',
      world: { title: 'Valmoret', intro: 'Une ville.', goal: 'Trouver la clé.', secret: 'Un géant dort.' },
      characters: [],
      cast: [],
      history: [],
      sceneNumber: 1,
      total: 3,
    };
    const job: GameJob = { id: 'j', kind: 'scene', input };
    await expect(runAventureJob(job, makeCtx({ ai }).ctx, new AbortController().signal)).rejects.toThrow(/hors format/);
  });

  it('le prompt de scène transmet l’objectif, le secret, les personnages déjà rencontrés et les conséquences passées', () => {
    const input: JobInput = {
      kind: 'scene',
      world: { title: 'Valmoret', intro: 'Une ville.', goal: 'Trouver la clé.', secret: 'Un géant dort.' },
      characters: [],
      cast: [
        { name: 'Madame Orme', title: 'Gardienne', attitude: 'Méfiante.', met: true, relation: 'amical' },
        { name: 'Jules', title: 'Enfant', attitude: 'Craintif.', met: false, relation: 'neutre' },
      ],
      history: ['La rue : Ana tente « Suivre » (réussi, jet 14 contre 10). Le murmure les guide.'],
      sceneNumber: 2,
      total: 4,
      difficulty: 'Normale',
    };
    const { user } = buildPrompt(input);
    expect(user).toContain('Trouver la clé.');
    expect(user).toContain('Un géant dort.');
    expect(user).toContain('Madame Orme, Gardienne. Méfiante. Lien avec le groupe : amical. (déjà rencontré)');
    expect(user).toContain('Jules, Enfant. Craintif. Lien avec le groupe : neutre. (pas encore rencontré)');
    expect(user).toContain('Difficulté choisie au salon : Normale.');
    expect(user).toContain('Le murmure les guide.');
    expect(user).toContain('affrontement');
  });

  it('parseJsonObject accepte un objet entouré de texte et ne recopie pas la réponse dans l’erreur', () => {
    expect(parseJsonObject('Voici : {"a":1} merci')).toEqual({ a: 1 });
    expect(() => parseJsonObject('rien ici')).toThrow('Réponse sans objet JSON.');
    expect(() => parseJsonObject('{"a": {"b": 1}')).toThrow('Réponse JSON illisible.');
  });
});

describe('personnages', () => {
  it('un personnage déjà pris est refusé ; un joueur peut changer pour un personnage libre', () => {
    const { s, ctx } = picked(4, mulberry32(9));
    expect(s.characters.find((c) => c.id === 'c1')?.ownerId).toBe('a');
    const refused = aventureIa.handleAction(s, B, 'pick', { characterId: 'c1' }, ctx);
    expect(refused.ok).toBe(false);
  });

  it('au bout du temps, les joueurs sans personnage reçoivent un personnage libre', () => {
    const { ctx } = makeCtx();
    let s = started(4, ctx);
    s = act(s, A, 'pick', { characterId: 'c1' }, ctx);
    s = aventureIa.onTimer(s, 'choose-timeout', ctx) === s ? s : aventureIa.onTimer(s, 'choose-timeout', ctx);
    expect(s.characters.every((c) => c.ownerId !== null || c.id !== 'c1')).toBe(true);
    expect(s.characters.filter((c) => c.ownerId !== null)).toHaveLength(3);
  });

  it('la régénération n’est possible qu’avant le premier choix', () => {
    const { ctx } = makeCtx();
    const s = started(4, ctx);
    expect(aventureIa.handleHostAction!(s, 'regenerate', {}, ctx).ok).toBe(true);
    const picking = act(s, A, 'pick', { characterId: 'c1' }, ctx);
    expect(aventureIa.handleHostAction!(picking, 'regenerate', {}, ctx).ok).toBe(false);
  });
});

describe('scènes et votes', () => {
  it('un jet réussi applique la conséquence de réussite du choix retenu, et donne de l’expérience', () => {
    const { s: base, ctx } = inVote(constant(NAT20));
    const s0 = finishJob(base, voteScene(), ctx);
    const s1 = act(s0, A, 'vote', { choiceId: 'o1' }, ctx);
    const s2 = act(s1, B, 'vote', { choiceId: 'o1' }, ctx);
    const s3 = act(s2, C, 'vote', { choiceId: 'o1' }, ctx);
    expect(s3.resolution?.success).toBe(true);
    expect(s3.resolution?.consequence).toBe('Vous passez.');
    expect(s3.characters.find((c) => c.ownerId === 'a')?.xp).toBe(10);
    expect(s3.history.at(-1)?.text).toContain('Vous passez.');
  });

  it('un jet raté applique la conséquence d’échec et retire 2 PV à celui qui a voté', () => {
    const { s: base, ctx } = inVote(constant(NAT1));
    const s0 = finishJob(base, voteScene(), ctx);
    const s1 = act(s0, A, 'vote', { choiceId: 'o2' }, ctx);
    const s2 = act(s1, B, 'vote', { choiceId: 'o2' }, ctx);
    const s3 = act(s2, C, 'vote', { choiceId: 'o2' }, ctx);
    expect(s3.resolution?.success).toBe(false);
    expect(s3.resolution?.consequence).toBe('Une impasse.');
    expect(s3.characters.find((c) => c.ownerId === 'a')?.pv).toBeLessThan(
      s0.characters.find((c) => c.ownerId === 'a')!.pv,
    );
  });

  it('les voix et les conséquences restent secrètes : la vue publique ne les révèle pas avant le jet', () => {
    const { s: base, ctx } = inVote();
    const s0 = finishJob(base, voteScene(), ctx);
    const s1 = act(s0, A, 'vote', { choiceId: 'o1' }, ctx);
    const pub = JSON.stringify(aventureIa.getPublicState(s1));
    expect(pub).not.toContain('Vous passez.');
    expect(pub).not.toContain('Vous glissez.');
    expect(pub).not.toContain(s1.world!.secret);
    expect(JSON.stringify(aventureIa.getPlayerState(s1, B.id))).not.toContain('"o1"');
  });

  it('un personnage à terre ne peut plus voter', () => {
    const { s: base, ctx } = inVote();
    const s0 = finishJob(base, voteScene(), ctx);
    const downed = { ...s0, characters: s0.characters.map((c) => (c.ownerId === 'a' ? { ...c, pv: 0 } : c)) };
    expect(aventureIa.handleAction(downed, A, 'vote', { choiceId: 'o1' }, ctx).ok).toBe(false);
  });

  it('le minuteur de vote résout avec les voix reçues, sans voix : choix au hasard', () => {
    const { s: base, ctx } = inVote();
    const s0 = finishJob(base, voteScene(), ctx);
    const s1 = aventureIa.onTimer(s0, 'vote-timeout', ctx);
    expect(s1.resolution).not.toBeNull();
    expect(s1.reveal).toBe(true);
  });
});

describe('affrontements', () => {
  it('une scène d’affrontement ouvre directement une manche, avec l’ennemi visible et sans choix', () => {
    const { s: base, ctx } = inVote();
    const s = finishJob(base, fightScene(9), ctx);
    expect(s.phase).toBe('combat');
    expect(s.combat?.step).toBe('act');
    expect(s.combat?.round).toBe(1);
    expect(s.combat?.foe.hp).toBe(9);
    expect(s.scene?.choices).toEqual([]);
    const pub = aventureIa.getPublicState(s) as { combat: { foe: { name: string; hp: number } } };
    expect(pub.combat.foe).toMatchObject({ name: 'Statue', hp: 9 });
  });

  it('une manche ne se règle que lorsque chacun a choisi, et les actions restent secrètes', () => {
    const { s: base, ctx } = inVote();
    let s = finishJob(base, fightScene(14), ctx);
    s = act(s, A, 'combat', { action: 'frapper' }, ctx);
    expect(s.phase).toBe('combat');
    expect(JSON.stringify(aventureIa.getPublicState(s))).not.toContain('frapper');
    expect(aventureIa.getPlayerState(s, B.id)).toMatchObject({ canAct: true, acted: false, myAction: null });
    expect(aventureIa.getPlayerState(s, A.id)).toMatchObject({ acted: true, myAction: 'frapper', canAct: false });
    s = act(s, B, 'combat', { action: 'soigner' }, ctx);
    s = act(s, C, 'combat', { action: 'parlementer' }, ctx);
    expect(s.combat?.step).toBe('reveal');
    expect(s.combat?.report?.lines).toHaveLength(3);
  });

  it('un coup critique de Frapper inflige 4 dégâts ; la victoire termine le combat et l’histoire continue', () => {
    const { s: base, ctx } = inVote(constant(NAT20));
    let s = finishJob(base, fightScene(10), ctx);
    for (const p of PLAYERS) s = act(s, p, 'combat', { action: 'frapper' }, ctx);
    expect(s.combat?.report?.foeHp).toBe(0);
    expect(s.combat?.report?.outcome).toBe('victory');
    expect(s.combat?.over).toBe(true);
    expect(s.history.at(-1)?.text).toContain('La statue tombe en poussière.');
    expect(s.reveal).toBe(true);
  });

  it('un coup manqué laisse l’ennemi riposter sur un personnage debout', () => {
    const { s: base, ctx } = inVote(constant(LOW));
    let s = finishJob(base, fightScene(14, 14, 2), ctx);
    const before = s.characters.filter((c) => c.ownerId !== null).reduce((sum, c) => sum + c.pv, 0);
    for (const p of PLAYERS) s = act(s, p, 'combat', { action: 'frapper' }, ctx);
    const after = s.characters.filter((c) => c.ownerId !== null).reduce((sum, c) => sum + c.pv, 0);
    expect(s.combat?.report?.riposte).toMatch(/frappe/);
    expect(after).toBe(before - 2);
    expect(s.combat?.report?.lines.every((l) => !l.success)).toBe(true);
  });

  it('une feinte réussie, ou une parlotte réussie, empêche la riposte', () => {
    const { s: base, ctx } = inVote(constant(NAT20));
    let s = finishJob(base, fightScene(14, 10, 3), ctx);
    s = act(s, A, 'combat', { action: 'parlementer' }, ctx);
    s = act(s, B, 'combat', { action: 'soigner' }, ctx);
    s = act(s, C, 'combat', { action: 'soigner' }, ctx);
    expect(s.combat?.report?.riposte).toMatch(/recule/);
  });

  it('le minuteur de manche règle la manche, les joueurs muets jouent une action au hasard', () => {
    const { s: base, ctx } = inVote(mulberry32(5));
    let s = finishJob(base, fightScene(14), ctx);
    s = aventureIa.onTimer(s, 'combat-timeout', ctx);
    expect(s.combat?.step).toBe('reveal');
    expect(s.combat?.report?.lines).toHaveLength(3);
  });

  it('après le bilan d’une manche, la manche suivante commence', () => {
    const { s: base, ctx } = inVote(constant(LOW));
    let s = finishJob(base, fightScene(14, 14, 1), ctx);
    for (const p of PLAYERS) s = act(s, p, 'combat', { action: 'frapper' }, ctx);
    expect(s.combat?.step).toBe('reveal');
    s = aventureIa.onTimer(s, 'reveal-timeout', ctx);
    expect(s.combat?.step).toBe('act');
    expect(s.combat?.round).toBe(2);
    expect(s.combat?.actions).toEqual({});
  });

  it('un personnage à terre ne peut plus agir en combat', () => {
    const { s: base, ctx } = inVote();
    const s0 = finishJob(base, fightScene(10), ctx);
    const downed = { ...s0, characters: s0.characters.map((c) => (c.ownerId === 'a' ? { ...c, pv: 0 } : c)) };
    expect(aventureIa.handleAction(downed, A, 'combat', { action: 'frapper' }, ctx).ok).toBe(false);
  });

  it('une action de combat inconnue est refusée', () => {
    const { s: base, ctx } = inVote();
    const s0 = finishJob(base, fightScene(10), ctx);
    expect(aventureIa.handleAction(s0, A, 'combat', { action: 'danser' }, ctx).ok).toBe(false);
  });
});

describe('règles de combat (pures)', () => {
  const foe = {
    name: 'Gobelin',
    title: 'Sbire',
    emoji: '👺',
    intro: '',
    hp: 6,
    hpMax: 6,
    defense: 10,
    damage: 3,
    onVictory: 'Fin.',
    loot: null,
  };
  const hero = (id: string, owner: string, extra: Partial<Character> = {}): Character => ({
    id,
    libraryId: null,
    name: id.toUpperCase(),
    title: '',
    emoji: '',
    backstory: '',
    stats: { force: 3, ruse: 3, esprit: 3, charme: 3 },
    pvMax: 8,
    pv: 8,
    ability: { name: '', text: '' },
    flaw: '',
    item: '',
    bag: [],
    level: 1,
    xp: 0,
    xpStart: 0,
    games: 0,
    victories: 0,
    ownerId: owner,
    ...extra,
  });
  const combatOf = (actions: Combat['actions'], round = 1): Combat => ({
    foe,
    sceneTitle: 'Test',
    round,
    step: 'act',
    actions,
    report: null,
    over: false,
    progress: [],
  });
  const name = (id: string) => id;

  it('soigner rend des PV au plus blessé, sans dépasser le maximum', () => {
    const chars = [hero('h1', 'a', { pv: 8 }), hero('h2', 'b', { pv: 3 })];
    // Le charme de b bloque la riposte, pour que le soin se voie seul.
    const result = resolveRound({
      characters: chars,
      order: ['a', 'b'],
      combat: combatOf({ a: 'soigner', b: 'parlementer' }),
      random: constant(NAT20),
      ownerName: name,
    });
    const healed = result.characters.find((c) => c.id === 'h2');
    expect(healed?.pv).toBe(3 + 3);
    expect(result.characters.find((c) => c.id === 'h1')?.pv).toBe(8);
  });

  it('un 1 naturel fait trébucher : le personnage perd 1 PV', () => {
    const result = resolveRound({
      characters: [hero('h1', 'a')],
      order: ['a'],
      combat: combatOf({ a: 'frapper' }),
      random: constant(NAT1),
      ownerName: name,
    });
    expect(result.characters[0]?.pv).toBeLessThan(8);
    expect(result.report.lines[0]?.text).toMatch(/trébuche/);
  });

  it('une riposte qui fait tomber le dernier personnage debout mène à la défaite', () => {
    const result = resolveRound({
      characters: [hero('h1', 'a', { pv: 1 })],
      order: ['a'],
      combat: combatOf({ a: 'frapper' }),
      random: constant(LOW),
      ownerName: name,
    });
    expect(result.outcome).toBe('defeat');
    expect(result.report.riposte).toMatch(/à terre/);
  });

  it('l’ennemi s’enfuit après le nombre maximal de manches', () => {
    const result = resolveRound({
      characters: [hero('h1', 'a', { pv: 8 })],
      order: ['a'],
      combat: combatOf({ a: 'frapper' }, MAX_ROUNDS),
      random: constant(LOW),
      ownerName: name,
    });
    expect(result.outcome).toBe('flight');
    expect(result.report.consequence).toMatch(/s’enfuit/);
  });

  it('sans action choisie, l’action est tirée au hasard, et les actions restent dans les quatre prévues', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) seen.add(pickAction(mulberry32(i)));
    expect([...seen].sort()).toEqual(['feinter', 'frapper', 'parlementer', 'soigner']);
  });
});

describe('aventure complète', () => {
  it('une partie de secours se joue jusqu’à l’épilogue, sans personne bloqué, et suit une seule intrigue', () => {
    const { ctx } = makeCtx({ random: mulberry32(11) });
    let s = started(4, ctx);
    let guard = 0;
    while (s.phase !== 'final' && guard < 400) {
      guard += 1;
      if (aventureIa.pendingJob!(s)) {
        s = finishJob(s, null, ctx);
      } else if (s.reveal) {
        s = aventureIa.nextRound!(s, ctx);
      } else if (s.phase === 'choose' || s.phase === 'vote' || s.phase === 'combat') {
        for (const p of PLAYERS) {
          const move = aventureIa.suggest!(s, p.id, ctx.random);
          if (move) s = act(s, p, move.type, move.payload, ctx);
        }
        if (s.phase === 'choose' || s.phase === 'vote' || s.phase === 'combat') {
          s = aventureIa.nextRound!(s, ctx);
        }
      } else {
        throw new Error(`phase bloquée : ${s.phase}`);
      }
    }
    expect(s.phase).toBe('final');
    expect(s.epilogue).not.toBeNull();
    const titles = s.history.map((h) => h.sceneTitle);
    const arc = FALLBACK_ARCS[s.arc!]!;
    expect(arc.scenes.map((x) => x.title)).toEqual(expect.arrayContaining([...new Set(titles)]));
    expect(s.history.every((h) => h.text.length > 0)).toBe(true);
  });

  it('l’arrêt par l’hôte termine la partie sans épilogue', () => {
    const { s: base, ctx } = inVote();
    const s = aventureIa.end(base, ctx);
    expect(s.phase).toBe('final');
    expect(s.epilogue).toBeNull();
  });
});

describe('secours', () => {
  it('chaque intrigue de secours tient en une seule histoire : ouverture, dénouement, et des choix ou un ennemi partout', () => {
    for (const arc of FALLBACK_ARCS) {
      expect(arc.world.goal).toBeTruthy();
      expect(arc.npcs.length).toBeGreaterThanOrEqual(2);
      arc.scenes.forEach((scene) => {
        expect(sceneDraftSchema.safeParse(scene).success).toBe(true);
      });
    }
    for (const [total, picks] of Object.entries(FALLBACK_SCENE_PICKS)) {
      expect(picks).toHaveLength(Number(total));
      expect(picks[0]).toBe(0);
      expect(picks.at(-1)).toBe(5);
    }
  });

  it('une scène de secours choisie par intrigue suit l’ordre de l’histoire, et les combats restent rares', () => {
    for (let arc = 0; arc < FALLBACK_ARCS.length; arc += 1) {
      for (const total of [3, 4, 5, 6]) {
        const titles = Array.from(
          { length: total },
          (_, i) => fallbackScene(mulberry32(1), arc, i + 1, total, []).title,
        );
        const fights = Array.from({ length: total }, (_, i) =>
          fallbackScene(mulberry32(1), arc, i + 1, total, []),
        ).filter((scene) => scene.enemy);
        expect(new Set(titles).size).toBe(total);
        expect(fights.length).toBeLessThanOrEqual(Math.ceil(total / 2));
      }
    }
  });

  it('sans intrigue écrite (monde de l’IA), la réserve générique ne répète pas une scène déjà jouée', () => {
    const used = FALLBACK_SCENES.filter((s) => !s.enemy).map((s) => s.title);
    const generic = fallbackScene(mulberry32(2), null, 1, 4, []);
    const again = fallbackScene(mulberry32(2), null, 2, 4, [generic.title]);
    expect(again.title).not.toBe(generic.title);
    expect(used.length).toBeGreaterThan(0);
  });

  it('les personnages secondaires de l’intrigue sont cités par les scènes qui les mettent en jeu', () => {
    for (const arc of FALLBACK_ARCS) {
      const names = new Set(arc.npcs.map((n) => n.name));
      const met = arc.scenes.flatMap((s) => (s.npc ? [s.npc.name] : []));
      expect(met.length).toBeGreaterThan(0);
      expect(met.every((n) => names.has(n))).toBe(true);
    }
  });
});

describe('contrat du module', () => {
  it('la vue joueur ne révèle ni les actions ni les voix des autres', () => {
    const { s: base, ctx } = inVote();
    let s = finishJob(base, fightScene(14), ctx);
    s = act(s, A, 'combat', { action: 'feinter' }, ctx);
    const viewB = JSON.stringify(aventureIa.getPlayerState(s, B.id));
    expect(viewB).not.toContain('feinter');
    const viewPublic = JSON.stringify(aventureIa.getPublicState(s));
    expect(viewPublic).not.toContain('feinter');
    expect(viewPublic).not.toContain(s.world!.secret);
  });
});

describe('file de travaux', () => {
  it('le travail en attente est stable jusqu’à son achèvement', () => {
    const { ctx } = makeCtx();
    const s = started(4, ctx);
    const first = aventureIa.pendingJob!(s);
    expect(aventureIa.pendingJob!(s)).toEqual(first);
    expect(aventureIa.completeJob!(s, 'job-999', { ok: true, value: null }, ctx)).toBe(s);
  });

  it('les minuteurs de combat et de révélation sont annulés à la fin', () => {
    const { s: base, ctx, timers } = inVote();
    const s = finishJob(base, fightScene(10), ctx);
    expect(timers.has('combat-timeout')).toBe(true);
    aventureIa.end(s, ctx);
    expect(timers.has('combat-timeout')).toBe(false);
    expect(timers.has('reveal-timeout')).toBe(false);
  });
});

describe('robots', () => {
  it('un robot vote pour un choix valide, puis agit en combat quand un ennemi surgit', () => {
    const { s: base, ctx } = inVote();
    const withVote = finishJob(base, voteScene(), ctx);
    const vote = aventureIa.suggest!(withVote, A.id, ctx.random);
    expect(vote?.type).toBe('vote');
    const withFight = finishJob(base, fightScene(10), ctx);
    const move = aventureIa.suggest!(withFight, A.id, ctx.random);
    expect(move?.type).toBe('combat');
    expect(move?.payload).toMatchObject({ action: expect.stringMatching(/frapper|feinter|soigner|parlementer/) });
  });
});
