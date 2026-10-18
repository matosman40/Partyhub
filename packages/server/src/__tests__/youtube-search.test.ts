import { describe, expect, it } from 'vitest';
import { createSearchLimiter, createYoutubeSearch, YoutubeSearchError } from '../youtube/search.js';

/** Fausse réponse de l’API YouTube : on garde les appels pour vérifier ce qui part vers Google. */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: URL | string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const items = [
  {
    id: { videoId: 'VHoT4N43jK8' },
    snippet: { title: 'Alors on danse &amp; co &#39;x&#39;', channelTitle: 'Stromae' },
  },
  // Une chaîne n’est pas une vidéo : elle est ignorée.
  { id: { kind: 'youtube#channel', channelId: 'UC123' }, snippet: { title: 'Une chaîne', channelTitle: 'X' } },
  // Un identifiant mal formé ne passe pas.
  { id: { videoId: 'trop-court' }, snippet: { title: 'Court', channelTitle: 'Y' } },
];

describe('recherche YouTube : clé et validation', () => {
  it('sans clé, la recherche est désactivée et ne part pas vers YouTube', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    const search = createYoutubeSearch({ apiKey: '   ', fetchImpl });
    expect(search.enabled).toBe(false);
    await expect(search.search('abc')).rejects.toMatchObject({ code: 'disabled' });
    expect(calls).toHaveLength(0);
  });

  it('refuse une requête trop courte ou trop longue sans appeler YouTube', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    const search = createYoutubeSearch({ apiKey: 'K', fetchImpl });
    await expect(search.search('a')).rejects.toMatchObject({ code: 'invalid' });
    await expect(search.search('x'.repeat(81))).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
  });
});

describe('recherche YouTube : résultats', () => {
  it('envoie seulement les vidéos intégrables, avec la clé, et décode les titres', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    const search = createYoutubeSearch({ apiKey: 'K', fetchImpl });
    const hits = await search.search('  alors   on danse ');
    expect(hits).toEqual([{ videoId: 'VHoT4N43jK8', title: "Alors on danse & co 'x'", channel: 'Stromae' }]);
    expect(calls[0]).toContain('videoEmbeddable=true');
    expect(calls[0]).toContain('type=video');
    expect(calls[0]).toContain('q=alors+on+danse');
    expect(calls[0]).toContain('key=K');
  });

  it('garde le résultat une heure, sans appeler YouTube une seconde fois', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    let clock = 0;
    const search = createYoutubeSearch({ apiKey: 'K', fetchImpl, now: () => clock });
    await search.search('stromae');
    clock += 30 * 60 * 1000;
    await search.search('Stromae');
    expect(calls).toHaveLength(1);
    clock += 31 * 60 * 1000;
    await search.search('stromae');
    expect(calls).toHaveLength(2);
  });

  it('un quota épuisé est signalé à part', async () => {
    const { fetchImpl } = fakeFetch({ error: 'quotaExceeded' }, 403);
    const search = createYoutubeSearch({ apiKey: 'K', fetchImpl });
    await expect(search.search('abc')).rejects.toMatchObject({ code: 'quota' });
  });

  it('une panne réseau devient une erreur générique, sans le détail (qui peut contenir la clé)', async () => {
    const fetchImpl = (async () => {
      throw new Error('échec sur https://www.googleapis.com/youtube/v3/search?key=K');
    }) as unknown as typeof fetch;
    const search = createYoutubeSearch({ apiKey: 'K', fetchImpl });
    const error = await search.search('abc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YoutubeSearchError);
    expect((error as YoutubeSearchError).code).toBe('unavailable');
    expect((error as Error).message).not.toContain('key=');
  });
});

describe('limiteur de recherches', () => {
  it('autorise un nombre de recherches par minute et par adresse, puis réinitialise', () => {
    const limiter = createSearchLimiter(2);
    expect(limiter.allow('1.2.3.4', 0)).toBe(true);
    expect(limiter.allow('1.2.3.4', 1000)).toBe(true);
    expect(limiter.allow('1.2.3.4', 2000)).toBe(false);
    expect(limiter.allow('5.6.7.8', 2000)).toBe(true);
    expect(limiter.allow('1.2.3.4', 61_000)).toBe(true);
  });
});
