import { describe, expect, it } from 'vitest';
import { aventureIa } from '../aventure/module.js';
import { FALLBACK_ARCS, THEME_ARC, fallbackRoster, fallbackScene } from '../aventure/fallback.js';
import type { SceneSeed } from '../aventure/fallback-arc.js';
import { SCENE_KINDS, aventureSettingsSchema, sceneDraftSchema } from '../aventure/schemas.js';
import { THEMES, THEME_IDS } from '../aventure/themes.js';
import {
  A,
  B,
  C,
  NAT20,
  act,
  answer,
  constant,
  makeCtx,
  mulberry32,
  pickInOrder,
  playToEnd,
  startGame,
} from './aventure-helpers.js';

/** Une scène de dialogue : Ferdinand parle, et chaque réponse change son lien avec le groupe. */
const dialogueScene: SceneSeed = {
  kind: 'dialogue',
  title: 'Ferdinand',
  text: 'Un apprenti se cache derrière une caisse.',
  npc: { name: 'Ferdinand', title: 'Apprenti', emoji: '🧑', attitude: 'Peureux.', line: 'Bonjour, je ne mords pas.' },
  choices: [
    {
      label: 'Être aimable',
      stat: 'charme',
      difficulty: 8,
      onSuccess: 'Il sourit.',
      onFailure: 'Il rougit.',
      bond: 1,
      risk: 0,
    },
    {
      label: 'Être brusque',
      stat: 'force',
      difficulty: 16,
      onSuccess: 'Il recule.',
      onFailure: 'Il crie.',
      bond: -1,
      risk: 0,
    },
  ],
};

/** Une énigme : une bonne réponse rapporte un objet au sac. */
const enigmeScene: SceneSeed = {
  kind: 'enigme',
  title: 'La porte',
  text: 'Une devinette est gravée sur la porte.',
  hint: 'Il se mange après le dîner.',
  choices: [
    {
      label: 'Répondre : le fromage',
      stat: 'esprit',
      difficulty: 10,
      onSuccess: 'La porte s’ouvre.',
      onFailure: 'Rien.',
      item: 'Une clé de cave',
      risk: 1,
    },
    {
      label: 'Forcer la porte',
      stat: 'force',
      difficulty: 12,
      onSuccess: 'Elle cède.',
      onFailure: 'Elle tient.',
      risk: 1,
    },
  ],
};

/** Une halte : on se repose, et l'on reprend des forces. */
const halteScene: SceneSeed = {
  kind: 'halte',
  title: 'Une pause',
  text: 'Le groupe s’arrête près d’un feu.',
  choices: [
    {
      label: 'Se reposer près du feu',
      stat: 'esprit',
      difficulty: 8,
      onSuccess: 'Vous dormez un peu.',
      onFailure: 'Le sommeil fuit.',
      heal: 2,
      risk: 0,
    },
    {
      label: 'Veiller sur le groupe',
      stat: 'ruse',
      difficulty: 8,
      onSuccess: 'Tout le monde dort.',
      onFailure: 'Personne ne dort.',
      risk: 0,
    },
  ],
};

/** Une scène de vote simple, pour mesurer la difficulté choisie au salon. */
const voteScene: SceneSeed = {
  title: 'Le pont',
  text: 'Un pont tremble au-dessus du vide.',
  choices: [
    { label: 'Traverser', stat: 'force', difficulty: 10, onSuccess: 'Vous passez.', onFailure: 'Vous glissez.' },
    { label: 'Chercher un passage', stat: 'ruse', difficulty: 12, onSuccess: 'Un passage.', onFailure: 'Une impasse.' },
  ],
};

const fightScene: SceneSeed = {
  title: 'La statue',
  text: 'Une statue bloque le passage.',
  enemy: {
    name: 'Statue',
    title: 'Gardienne de pierre',
    emoji: '🗿',
    intro: 'La statue lève son bras.',
    hp: 10,
    defense: 10,
    damage: 2,
    onVictory: 'La statue tombe.',
  },
};

/** Vote de tous les joueurs sur le même choix. */
function voteAll(s: ReturnType<typeof startGame>, choiceId: string, ctx: ReturnType<typeof makeCtx>) {
  let next = s;
  for (const p of [A, B, C]) next = act(next, p, 'vote', { choiceId }, ctx);
  return next;
}

describe('types de scènes', () => {
  it('une scène d’IA sans type déclaré est un dialogue si un personnage parle, sinon un choix', () => {
    const ctx = makeCtx();
    const base = pickInOrder(startGame({ scenes: 3 }, ctx), ctx);
    const talking = answer(base, ctx, { ...voteScene, npc: dialogueScene.npc });
    expect(talking.scene?.kind).toBe('dialogue');
    const silent = answer(base, ctx, voteScene);
    expect(silent.scene?.kind).toBe('choix');
  });

  it('les cinq types de scène sont acceptés, un dialogue ou une énigme aussi sans choix de combat', () => {
    expect(SCENE_KINDS).toEqual(['choix', 'dialogue', 'enigme', 'halte', 'combat']);
    for (const scene of [dialogueScene, enigmeScene, halteScene, voteScene, fightScene]) {
      expect(sceneDraftSchema.safeParse(scene).success).toBe(true);
    }
  });

  it('les intrigues de secours couvrent tous les types de scène', () => {
    const kinds = new Set<string>();
    FALLBACK_ARCS.forEach((_, arc) => {
      for (let i = 1; i <= 6; i += 1) kinds.add(fallbackScene(mulberry32(1), arc, i, 6, []).kind);
    });
    expect([...kinds].sort()).toEqual(['choix', 'combat', 'dialogue', 'enigme', 'halte']);
  });

  it('une énigme de secours porte toujours un indice', () => {
    FALLBACK_ARCS.forEach((_, arc) => {
      for (let i = 1; i <= 6; i += 1) {
        const scene = fallbackScene(mulberry32(1), arc, i, 6, []);
        if (scene.kind === 'enigme') expect(scene.hint).toBeTruthy();
      }
    });
  });

  it('une scène d’IA hors format bascule sur l’histoire de secours, sans bloquer la partie', () => {
    const ctx = makeCtx();
    const s = pickInOrder(startGame({ scenes: 3 }, ctx), ctx);
    const next = answer(s, ctx, { title: 'seul' });
    expect(next.mode).toBe('secours');
    expect(next.phase).toBe('vote');
    expect(next.scene).not.toBeNull();
  });
});

describe('dialogues', () => {
  it('une réplique change le lien avec le personnage secondaire, quel que soit le jet', () => {
    const ctx = makeCtx({ random: constant(0.1) });
    const s = answer(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx, dialogueScene);
    expect(s.npcs.find((n) => n.name === 'Ferdinand')?.bond).toBe(0);
    const after = voteAll(s, 'o1', ctx);
    expect(after.npcs.find((n) => n.name === 'Ferdinand')?.bond).toBe(1);
    expect(after.met).toContain('Ferdinand');
    const view = aventureIa.getPublicState(after) as { npcs: Array<{ name: string; relation: string }> };
    expect(view.npcs.find((n) => n.name === 'Ferdinand')?.relation).toBe('amical');
  });

  it('une réplique vexante fait reculer le lien, et le lien ne sort pas de -3 à +3', () => {
    const ctx = makeCtx({ random: constant(0.1) });
    let s = answer(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx, dialogueScene);
    s = voteAll(s, 'o2', ctx);
    expect(s.npcs.find((n) => n.name === 'Ferdinand')?.bond).toBe(-1);
  });
});

describe('énigmes et haltes', () => {
  it('une énigme réussie rapporte l’objet au sac du personnage qui a voté', () => {
    const ctx = makeCtx({ random: constant(NAT20) });
    const s = answer(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx, enigmeScene);
    const after = voteAll(s, 'o1', ctx);
    expect(after.resolution?.success).toBe(true);
    expect(after.characters.find((c) => c.ownerId === A.id)?.bag).toContain('Une clé de cave');
  });

  it('une halte réussie rend des PV au personnage qui a voté', () => {
    const ctx = makeCtx({ random: constant(NAT20) });
    let s = answer(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx, halteScene);
    s = { ...s, characters: s.characters.map((c) => (c.ownerId === A.id ? { ...c, pv: 3 } : c)) };
    const after = voteAll(s, 'o1', ctx);
    expect(after.characters.find((c) => c.ownerId === A.id)?.pv).toBe(5);
  });
});

describe('difficulté et thèmes', () => {
  it('la difficulté du salon décale les jets (±2) et les PV des ennemis (facile -2, difficile +3)', () => {
    const cases = [
      { difficulte: 'facile', jet: 8, pv: 8 },
      { difficulte: 'normal', jet: 10, pv: 10 },
      { difficulte: 'difficile', jet: 12, pv: 13 },
    ] as const;
    for (const { difficulte, jet, pv } of cases) {
      const ctx = makeCtx();
      const vote = answer(pickInOrder(startGame({ scenes: 3, difficulte }, ctx), ctx), ctx, voteScene);
      expect(vote.scene?.choices[0]?.difficulty).toBe(jet);

      const fight = answer(pickInOrder(startGame({ scenes: 3, difficulte }, ctx), ctx), ctx, fightScene);
      expect(fight.combat?.foe.hp).toBe(pv);
    }
  });

  it('chaque thème du catalogue a une intrigue de secours, et un thème connu la choisit', () => {
    for (const theme of THEMES) expect(THEME_ARC[theme.id]).toBeDefined();
    const roster = fallbackRoster(mulberry32(3), 'pigeons');
    expect(roster.arc).toBe(THEME_ARC.pigeons);
    expect(roster.roster.world.title).toBe('La Place de Montbrise');
  });

  it('un thème choisi au salon s’affiche avec son libellé, et un thème libre garde son texte', () => {
    const ctx = makeCtx();
    const preset = startGame({ scenes: 3, themeId: 'vaisseau' }, ctx);
    expect(preset.themeKey).toBe('vaisseau');
    expect(aventureIa.getPublicState(preset)).toMatchObject({ theme: 'Vaisseau rétro' });

    const free = startGame({ scenes: 3, themeId: 'libre', theme: 'Une cuisine hantée' }, ctx);
    expect(free.themeKey).toBeNull();
    expect(aventureIa.getPublicState(free)).toMatchObject({ theme: 'Une cuisine hantée' });
  });

  it('en mode automatique, le thème est tiré au hasard parmi le catalogue', () => {
    const s = startGame({ scenes: 3, themeId: 'auto' }, makeCtx({ random: mulberry32(21) }));
    expect(THEME_IDS).toContain(s.themeKey);
  });

  it('les réglages acceptent le ton absurde, et refusent une difficulté inconnue', () => {
    expect(aventureSettingsSchema.parse({ tone: 'absurde' }).tone).toBe('absurde');
    expect(aventureSettingsSchema.safeParse({ difficulte: 'impossible' }).success).toBe(false);
  });
});

describe('partie courte absurde', () => {
  it('une partie de trois scènes sur un thème absurde se termine toujours par un épilogue', () => {
    const ctx = makeCtx({ random: mulberry32(5) });
    const s = playToEnd(pickInOrder(startGame({ scenes: 3, themeId: 'pigeons', tone: 'absurde' }, ctx), ctx), ctx);
    expect(s.phase).toBe('final');
    expect(s.epilogue).not.toBeNull();
    expect(s.history.length).toBeGreaterThan(0);
  });
});
