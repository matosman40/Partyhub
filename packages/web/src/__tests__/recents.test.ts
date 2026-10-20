import { describe, expect, it } from 'vitest';
import { readRecents, rememberRecent } from '../nav/recents.js';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('recents', () => {
  it('garde la dernière page ouverte en tête, sans doublon', () => {
    const store = memoryStore();
    rememberRecent({ title: 'Magasin', to: '/magasin' }, store);
    rememberRecent({ title: 'Admin', to: '/admin' }, store);
    rememberRecent({ title: 'Magasin', to: '/magasin' }, store);
    expect(readRecents(store).map((entry) => entry.to)).toEqual(['/magasin', '/admin']);
  });

  it('ne garde que six pages', () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i += 1) rememberRecent({ title: `P${i}`, to: `/p${i}` }, store);
    const recents = readRecents(store);
    expect(recents).toHaveLength(6);
    expect(recents[0]?.to).toBe('/p9');
  });

  it('ignore une valeur illisible ou d’une autre forme', () => {
    const store = memoryStore();
    store.setItem('ph:recents', '{pas du json');
    expect(readRecents(store)).toEqual([]);
    store.setItem('ph:recents', JSON.stringify([{ title: 1 }, { title: 'ok', to: '/ok' }]));
    expect(readRecents(store)).toEqual([{ title: 'ok', to: '/ok' }]);
  });

  it('ne plante pas sans stockage disponible', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readRecents(broken)).toEqual([]);
    expect(() => rememberRecent({ title: 'x', to: '/x' }, broken)).not.toThrow();
    expect(() => rememberRecent({ title: 'x', to: '/x' }, null)).not.toThrow();
  });
});
