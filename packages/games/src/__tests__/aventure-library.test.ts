import { describe, expect, it } from 'vitest';
import type { ProfileDataStore } from '@partyhub/shared';
import { aventureIa } from '../aventure/module.js';
import { LIBRARY_MAX, libraryDataSchema, type SavedCharacter } from '../aventure/schemas.js';
import { A, C, act, makeCtx, mulberry32, pickInOrder, playToEnd, startGame } from './aventure-helpers.js';

/** Stockage de profil en mémoire, avec la même forme que celui du serveur (une valeur par profil). */
function memoryStore(initial: Record<string, unknown> = {}, opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const store: ProfileDataStore = {
    read: (profileId) => (data.has(profileId) ? (data.get(profileId) ?? null) : null),
    write: (profileId, value) => {
      if (opts.failWrites) throw new Error('Donnée de jeu trop volumineuse');
      data.set(profileId, JSON.parse(JSON.stringify(value)));
    },
  };
  return { data, store };
}

function savedCharacter(i: number): SavedCharacter {
  return {
    libraryId: `lib-${String(i).padStart(8, '0')}`,
    name: `Personnage ${i}`,
    title: 'Vétéran',
    emoji: '🙂',
    backstory: 'Il a déjà voyagé.',
    stats: { force: 2, ruse: 2, esprit: 3, charme: 3 },
    pvMax: 8,
    ability: { name: 'Habitude', text: 'Il sait où aller.' },
    flaw: 'Il exagère ses souvenirs.',
    item: 'Une vieille carte.',
    level: 1,
    xp: 0,
    games: 1,
    victories: 0,
    lastPlayed: i,
    portraitId: null,
  };
}

describe('bibliothèque des personnages', () => {
  it('une partie terminée garde les personnages des joueurs qui ont un profil, et pas les autres', () => {
    const { data, store } = memoryStore();
    const ctx = makeCtx({ profileData: store });
    const s = playToEnd(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx);
    expect(s.phase).toBe('final');
    expect([...data.keys()].sort()).toEqual(['p-ana', 'p-leo']);
    const [kept] = libraryDataSchema.parse(data.get('p-ana')).characters;
    expect(kept).toMatchObject({ games: 1 });
    expect(kept!.libraryId).toMatch(/^lib-[a-z0-9]{8}$/);
    expect(s.characters.find((c) => c.ownerId === C.id)?.games).toBe(1);
  });

  it('une deuxième partie reprend le personnage gardé, avec son niveau et son expérience', () => {
    const { data, store } = memoryStore();
    const firstCtx = makeCtx({ profileData: store });
    playToEnd(pickInOrder(startGame({ scenes: 3 }, firstCtx), firstCtx), firstCtx);
    const kept = libraryDataSchema.parse(data.get('p-ana')).characters[0]!;

    const ctx = makeCtx({ profileData: store });
    let s = startGame({ scenes: 3 }, ctx);
    const view = aventureIa.getPlayerState(s, A.id) as { library: Array<{ libraryId: string; inPlay: boolean }> };
    expect(view.library).toEqual([expect.objectContaining({ libraryId: kept.libraryId, inPlay: false })]);

    s = act(s, A, 'pick', { characterId: kept.libraryId }, ctx);
    s = act(s, { id: 'b', name: 'Léo' }, 'pick', { characterId: 'c2' }, ctx);
    s = act(s, C, 'pick', { characterId: 'c3' }, ctx);
    expect(s.characters.find((c) => c.id === kept.libraryId)).toMatchObject({
      ownerId: A.id,
      level: kept.level,
      xp: kept.xp,
      games: kept.games,
    });

    playToEnd(s, ctx);
    const after = libraryDataSchema.parse(data.get('p-ana')).characters;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ libraryId: kept.libraryId, games: kept.games + 1 });
  });

  it('la bibliothèque garde au plus quarante personnages, les plus récents d’abord', () => {
    const full = Array.from({ length: LIBRARY_MAX }, (_, i) => savedCharacter(i + 1));
    const { data, store } = memoryStore({ 'p-ana': { version: 1, characters: full } });
    const ctx = makeCtx({ profileData: store });
    playToEnd(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx);
    const kept = libraryDataSchema.parse(data.get('p-ana')).characters;
    expect(kept).toHaveLength(LIBRARY_MAX);
    // Le personnage joué par Ana est ajouté en tête ; le plus ancien (lastPlayed 1) sort.
    expect(kept.map((c) => c.lastPlayed)).not.toContain(1);
    expect(kept[0]!.lastPlayed).toBe(1_000_000);
  });

  it('une bibliothèque qui grandit à chaque partie garde chaque personnage joué, avec son portrait', () => {
    const { data, store } = memoryStore();
    for (let game = 0; game < 3; game += 1) {
      // Chaque partie tire ses identifiants de bibliothèque au hasard : une graine propre à chaque partie.
      const ctx = makeCtx({ profileData: store, random: mulberry32(100 + game) });
      playToEnd(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx);
    }
    const kept = libraryDataSchema.parse(data.get('p-ana')).characters;
    // Une seule fiche par personnage joué : trois parties avec le même joueur font trois personnages distincts.
    expect(new Set(kept.map((c) => c.libraryId)).size).toBe(kept.length);
    expect(kept.length).toBeGreaterThanOrEqual(3);
    expect(kept.every((c) => c.portraitId === null)).toBe(true);
  });

  it('une écriture qui échoue n’arrête pas la partie', () => {
    const { store } = memoryStore({}, { failWrites: true });
    const ctx = makeCtx({ profileData: store });
    const s = playToEnd(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx);
    expect(s.phase).toBe('final');
    expect(s.epilogue).not.toBeNull();
  });

  it('sans stockage de profil du tout, la partie se joue normalement', () => {
    const ctx = makeCtx();
    const s = playToEnd(pickInOrder(startGame({ scenes: 3 }, ctx), ctx), ctx);
    expect(s.phase).toBe('final');
  });

  it('un profil abîmé est ignoré, la partie repart sans bibliothèque', () => {
    const { store } = memoryStore({ 'p-ana': { version: 1, characters: [{ libraryId: 'mauvais' }] } });
    const s = startGame({ scenes: 3 }, makeCtx({ profileData: store }));
    expect(s.library[A.id]).toEqual([]);
  });

  it('une fiche abîmée au milieu ne fait pas perdre les autres personnages à la sauvegarde suivante', () => {
    const abîmée = { libraryId: 'mauvais' };
    const { data, store } = memoryStore({
      'p-ana': { version: 1, characters: [savedCharacter(1), abîmée, savedCharacter(2)] },
    });
    const ctx = makeCtx({ profileData: store });
    const s = startGame({ scenes: 3 }, ctx);
    expect(s.library[A.id]).toHaveLength(2);
    playToEnd(pickInOrder(s, ctx), ctx);
    const kept = libraryDataSchema.parse(data.get('p-ana')).characters.map((c) => c.lastPlayed);
    expect(kept).toEqual(expect.arrayContaining([1, 2]));
  });
});
