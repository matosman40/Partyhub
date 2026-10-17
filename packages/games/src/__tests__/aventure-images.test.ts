import { describe, expect, it } from 'vitest';
import type { GameContext, GameImage, GameImageRequest, GameImages, ProfileDataStore } from '@partyhub/shared';
import { aventureIa, type AventureState } from '../aventure/module.js';
import { backgroundPrompt, portraitPrompt } from '../aventure/images.js';
import { libraryDataSchema } from '../aventure/schemas.js';
import { PLAYERS, makeCtx, mulberry32, pickInOrder, playToEnd } from './aventure-helpers.js';

/** Un monde et six personnages, comme la réponse d'un modèle de langage. */
const ROSTER_TEXT = JSON.stringify({
  world: { title: 'Le Phare', intro: 'Une ville sur la brume.', goal: 'Rallumer le phare.', secret: 'Un géant dort.' },
  characters: Array.from({ length: 6 }, (_, i) => ({
    name: `Perso${i + 1}`,
    title: 'Vétéran',
    emoji: '🙂',
    backstory: 'Il a traversé la brume.',
    stats: { force: 2, ruse: 2, esprit: 3, charme: 3 },
    pvMax: 8,
    ability: { name: 'Intuition', text: 'Il sent les dangers.' },
    flaw: 'Il parle trop.',
    item: 'Une lanterne.',
    look: `Manteau bleu et chapeau jaune, ${i + 1}`,
  })),
  npcs: [],
});

const hex24 = (n: number) => n.toString(16).padStart(24, '0');

/** Fournisseur d'images factice : garde la trace des demandes, et renvoie des identifiants valides. */
function fakeImages(opts: { existing?: GameImage[]; failPortraits?: boolean } = {}) {
  const requests: GameImageRequest[] = [];
  const pool: GameImage[] = [...(opts.existing ?? [])];
  let seq = 1;
  const images: GameImages = {
    available: () => true,
    async generate(request) {
      requests.push(request);
      if (request.kind === 'portrait' && opts.failPortraits) return null;
      if (request.kind === 'fond' && pool.filter((i) => i.kind === 'fond' && i.tag === request.tag).length >= 12) {
        return null;
      }
      const id = hex24(seq);
      seq += 1;
      const image: GameImage = { id, kind: request.kind, tag: request.tag, url: `/api/ai-images/${id}` };
      pool.push(image);
      return image;
    },
    list: (kind, tag) => pool.filter((i) => i.kind === kind && i.tag === tag),
  };
  return { images, requests, pool };
}

function memoryStore() {
  const data = new Map<string, unknown>();
  const store: ProfileDataStore = {
    read: (profileId) => data.get(profileId) ?? null,
    write: (profileId, value) => {
      data.set(profileId, JSON.parse(JSON.stringify(value)));
    },
  };
  return { data, store };
}

/** Contexte avec un faux modèle de langage (qui renvoie le monde) et, au besoin, des images. */
function aiCtx(images?: GameImages, profileData?: ProfileDataStore): GameContext {
  const base = makeCtx({ random: mulberry32(11), ...(profileData ? { profileData } : {}) });
  return {
    ...base,
    ai: { complete: async () => ROSTER_TEXT, available: () => true },
    ...(images ? { images } : {}),
  };
}

/** Lance le travail du monde (texte et images), comme le fait la salle, puis l'intègre. */
async function rosterOf(ctx: GameContext): Promise<AventureState> {
  const init = aventureIa.initialize({ ...aventureIa.defaultSettings, themeId: 'vaisseau' }, PLAYERS, ctx);
  const started = aventureIa.start(init, ctx);
  if (!started.ok) throw new Error(started.error);
  const job = aventureIa.pendingJob!(started.state);
  if (!job) throw new Error('aucun travail');
  const value = await aventureIa.runJob!(job, ctx, new AbortController().signal);
  return aventureIa.completeJob!(started.state, job.id, { ok: true, value }, ctx);
}

describe('illustrations de l’Aventure IA', () => {
  it('sans fournisseur d’images, les personnages gardent leur dessin : aucun portrait, aucun fond', async () => {
    const s = await rosterOf(aiCtx());
    expect(s.mode).toBe('ia');
    expect(s.backgroundId).toBeNull();
    expect(s.characters.every((c) => c.portraitId === null)).toBe(true);
  });

  it('avec des images, chaque personnage reçoit son portrait et le monde son fond', async () => {
    const fake = fakeImages();
    const s = await rosterOf(aiCtx(fake.images));
    expect(s.mode).toBe('ia');
    expect(s.characters).toHaveLength(6);
    expect(s.characters.map((c) => c.portraitId)).toEqual(
      fake.pool.filter((i) => i.kind === 'portrait').map((i) => i.id),
    );
    expect(s.backgroundId).toBe(fake.pool.find((i) => i.kind === 'fond')?.id);
    expect(fake.requests.filter((r) => r.kind === 'portrait')).toHaveLength(6);
    expect(fake.requests.filter((r) => r.kind === 'fond')).toHaveLength(1);
  });

  it('les demandes de portrait décrivent le personnage, et le fond le monde', async () => {
    const fake = fakeImages();
    await rosterOf(aiCtx(fake.images));
    const portrait = fake.requests.find((r) => r.kind === 'portrait');
    expect(portrait?.prompt).toContain('Perso1');
    expect(portrait?.prompt).toContain('Manteau bleu');
    expect(portrait?.tag).toBe('vaisseau');
    const fond = fake.requests.find((r) => r.kind === 'fond');
    expect(fond?.prompt).toContain('Le Phare');
    expect(fond?.prompt).not.toMatch(/character named/);
  });

  it('une bibliothèque de fonds pleine pour le thème fournit le décor, sans nouvelle génération', async () => {
    const existing: GameImage[] = Array.from({ length: 12 }, (_, i) => ({
      id: hex24(900 + i),
      kind: 'fond',
      tag: 'vaisseau',
      url: `/api/ai-images/${hex24(900 + i)}`,
    }));
    const fake = fakeImages({ existing });
    const s = await rosterOf(aiCtx(fake.images));
    expect(existing.map((i) => i.id)).toContain(s.backgroundId);
    expect(fake.requests.filter((r) => r.kind === 'fond')).toHaveLength(1);
  });

  it('une image qui échoue laisse son personnage dessiné, sans bloquer l’aventure', async () => {
    const fake = fakeImages({ failPortraits: true });
    const s = await rosterOf(aiCtx(fake.images));
    expect(s.mode).toBe('ia');
    expect(s.characters.every((c) => c.portraitId === null)).toBe(true);
    expect(s.backgroundId).not.toBeNull();
  });

  it('le portrait d’un personnage gardé reste dans sa bibliothèque pour une autre partie', async () => {
    const { data, store } = memoryStore();
    const fake = fakeImages();
    const ctx = aiCtx(fake.images, store);
    const rostered = await rosterOf(ctx);
    const played = playToEnd(pickInOrder(rostered, ctx), ctx);
    expect(played.phase).toBe('final');
    const saved = libraryDataSchema.parse(data.get('p-ana')).characters;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.portraitId).toBe(rostered.characters[0]!.portraitId);
  });

  it('les descriptions d’image ne dépendent pas d’une réponse : elles se construisent à partir de la fiche', () => {
    const world = { title: 'T', intro: 'I.', goal: 'G.', secret: 'S.' };
    expect(backgroundPrompt(world, 'Vaisseau rétro')).toContain('Vaisseau rétro');
    const draft = JSON.parse(ROSTER_TEXT).characters[2];
    expect(portraitPrompt(draft, 'Vaisseau rétro')).toContain('Perso3');
  });
});
