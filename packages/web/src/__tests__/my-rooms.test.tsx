import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { MAX_MY_ROOMS, MY_ROOMS_KEY, readMyRooms, rememberMyRoom, saveMyRooms } from '../seat/my-rooms.js';
import { MyRoomsList, roomStatusLabel } from '../components/MyRooms.js';

/** Stockage en mémoire, avec le même contrat que localStorage pour ces deux méthodes. */
function fakeStore(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(MY_ROOMS_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    raw: () => data.get(MY_ROOMS_KEY) ?? null,
  };
}

describe('mémoire des salles de l’appareil', () => {
  it('ajoute les codes, le plus récent en tête, sans doublon', () => {
    const store = fakeStore();
    rememberMyRoom('AAAA', store);
    rememberMyRoom('BBBB', store);
    rememberMyRoom('AAAA', store);
    expect(readMyRooms(store)).toEqual(['AAAA', 'BBBB']);
  });

  it('garde au plus MAX_MY_ROOMS codes', () => {
    const store = fakeStore();
    for (let i = 0; i < MAX_MY_ROOMS + 5; i++) rememberMyRoom(`C${i}`, store);
    const list = readMyRooms(store);
    expect(list).toHaveLength(MAX_MY_ROOMS);
    expect(list[0]).toBe(`C${MAX_MY_ROOMS + 4}`);
  });

  it('ignore un contenu illisible ou d’un autre type', () => {
    expect(readMyRooms(fakeStore('pas du json'))).toEqual([]);
    expect(readMyRooms(fakeStore('{"a":1}'))).toEqual([]);
    expect(readMyRooms(fakeStore('["ok", 3, "", null, "AUTRE"]'))).toEqual(['ok', 'AUTRE']);
  });

  it('ne plante pas sans stockage disponible', () => {
    expect(readMyRooms(null)).toEqual([]);
    expect(() => rememberMyRoom('X', null)).not.toThrow();
    expect(() => saveMyRooms(['X'], null)).not.toThrow();
  });

  it('saveMyRooms remplace la liste', () => {
    const store = fakeStore('["A","B"]');
    saveMyRooms(['B'], store);
    expect(readMyRooms(store)).toEqual(['B']);
  });
});

describe('liste « Parties en cours » sur l’accueil', () => {
  it('ne rend rien quand il n’y a pas de partie', () => {
    expect(
      renderToStaticMarkup(
        <MemoryRouter>
          <MyRoomsList items={[]} />
        </MemoryRouter>,
      ),
    ).toBe('');
  });

  it('propose de reprendre une partie en cours et de rejoindre un salon ouvert', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MyRoomsList
          items={[
            { code: 'ABC123', gameName: 'Quiz party', status: 'in_game' },
            { code: 'XYZ789', gameName: 'Plutôt qui', status: 'waiting' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('Parties en cours');
    expect(html).toContain('Quiz party');
    expect(html).toContain('Partie en cours');
    expect(html).toContain('href="/j/ABC123"');
    expect(html).toContain('Reprendre');
    expect(html).toContain('Salon ouvert');
    expect(html).toContain('href="/j/XYZ789"');
    expect(html).toContain('Rejoindre');
  });

  it('libellés de statut', () => {
    expect(roomStatusLabel('in_game')).toBe('Partie en cours');
    expect(roomStatusLabel('waiting')).toBe('Salon ouvert');
    expect(roomStatusLabel('full')).toBe('Salon ouvert');
  });
});
