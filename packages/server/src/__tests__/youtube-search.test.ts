import { describe, expect, it } from 'vitest';
import { createSearchLimiter, createYoutube, parseIsoDuration, YoutubeError } from '../youtube/search.js';

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

/** Réponse de `videos.list` pour une vidéo enregistrée, intégrable, de 3 min 6 s. */
function videoBody(overrides: Record<string, unknown> = {}) {
  const item = {
    id: 'VHoT4N43jK8',
    snippet: { title: 'Stromae - Alors on danse &amp; co', channelTitle: 'Stromae', liveBroadcastContent: 'none' },
    contentDetails: { duration: 'PT3M6S' },
    status: { embeddable: true },
    ...overrides,
  };
  return { items: [item] };
}

const googleQuota = { error: { errors: [{ reason: 'quotaExceeded' }] } };

describe('YouTube : clé et validation', () => {
  it('sans clé, rien ne part vers YouTube et tout est désactivé', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    const youtube = createYoutube({ apiKey: '   ', fetchImpl });
    expect(youtube.enabled).toBe(false);
    await expect(youtube.search('abc')).rejects.toMatchObject({ code: 'disabled' });
    await expect(youtube.video('VHoT4N43jK8')).rejects.toMatchObject({ code: 'disabled' });
    expect(calls).toHaveLength(0);
  });

  it('refuse une requête trop courte ou trop longue sans appeler YouTube', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    await expect(youtube.search('a')).rejects.toMatchObject({ code: 'invalid' });
    await expect(youtube.search('x'.repeat(81))).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('refuse un identifiant de vidéo mal formé sans appeler YouTube', async () => {
    const { fetchImpl, calls } = fakeFetch(videoBody());
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    await expect(youtube.video('pas un id')).rejects.toMatchObject({ code: 'badId' });
    await expect(youtube.video('')).rejects.toMatchObject({ code: 'badId' });
    expect(calls).toHaveLength(0);
  });
});

describe('YouTube : recherche', () => {
  it('envoie seulement les vidéos intégrables, avec la clé, et décode les titres', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    const hits = await youtube.search('  alors   on danse ');
    expect(hits).toEqual([{ videoId: 'VHoT4N43jK8', title: "Alors on danse & co 'x'", channel: 'Stromae' }]);
    expect(calls[0]).toContain('videoEmbeddable=true');
    expect(calls[0]).toContain('type=video');
    expect(calls[0]).toContain('q=alors+on+danse');
    expect(calls[0]).toContain('key=K');
  });

  it('garde le résultat une heure, sans appeler YouTube une seconde fois', async () => {
    const { fetchImpl, calls } = fakeFetch({ items });
    let clock = 0;
    const youtube = createYoutube({ apiKey: 'K', fetchImpl, now: () => clock });
    await youtube.search('stromae');
    clock += 30 * 60 * 1000;
    await youtube.search('Stromae');
    expect(calls).toHaveLength(1);
    clock += 31 * 60 * 1000;
    await youtube.search('stromae');
    expect(calls).toHaveLength(2);
  });

  it('un quota épuisé, lu dans le motif de Google, est signalé à part', async () => {
    const { fetchImpl } = fakeFetch(googleQuota, 403);
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    await expect(youtube.search('abc')).rejects.toMatchObject({ code: 'quota' });
  });

  it('une clé refusée par Google n’est pas comptée comme un quota', async () => {
    const { fetchImpl } = fakeFetch({ error: { errors: [{ reason: 'keyInvalid' }] } }, 400);
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    await expect(youtube.search('abc')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('une panne réseau devient une erreur générique, sans le détail (qui peut contenir la clé)', async () => {
    const fetchImpl = (async () => {
      throw new Error('échec sur https://www.googleapis.com/youtube/v3/search?key=K');
    }) as unknown as typeof fetch;
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    const error = await youtube.search('abc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YoutubeError);
    expect((error as YoutubeError).code).toBe('unavailable');
    expect((error as Error).message).not.toContain('key=');
  });
});

describe('YouTube : vérification d’une vidéo', () => {
  it('accepte une vidéo intégrable et donne sa durée en secondes', async () => {
    const { fetchImpl, calls } = fakeFetch(videoBody());
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    const video = await youtube.video('VHoT4N43jK8');
    expect(video).toEqual({
      videoId: 'VHoT4N43jK8',
      title: 'Stromae - Alors on danse & co',
      channel: 'Stromae',
      durationSec: 186,
    });
    expect(calls[0]).toContain('id=VHoT4N43jK8');
    expect(calls[0]).toContain('key=K');
  });

  it('refuse une vidéo dont l’intégration est désactivée', async () => {
    const { fetchImpl } = fakeFetch(videoBody({ status: { embeddable: false } }));
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    await expect(youtube.video('VHoT4N43jK8')).rejects.toMatchObject({ code: 'notEmbeddable' });
  });

  it('refuse un direct et une vidéo à venir', async () => {
    const live = createYoutube({
      apiKey: 'K',
      fetchImpl: fakeFetch(videoBody({ snippet: { title: 'Direct', channelTitle: 'C', liveBroadcastContent: 'live' } }))
        .fetchImpl,
    });
    await expect(live.video('VHoT4N43jK8')).rejects.toMatchObject({ code: 'live' });

    const upcoming = createYoutube({
      apiKey: 'K',
      fetchImpl: fakeFetch(videoBody({ contentDetails: { duration: 'P0D' } })).fetchImpl,
    });
    await expect(upcoming.video('VHoT4N43jK8')).rejects.toMatchObject({ code: 'live' });
  });

  it('signale une vidéo introuvable (supprimée ou privée)', async () => {
    const { fetchImpl } = fakeFetch({ items: [] });
    const youtube = createYoutube({ apiKey: 'K', fetchImpl });
    await expect(youtube.video('VHoT4N43jK8')).rejects.toMatchObject({ code: 'notFound' });
  });

  it('garde la vérification une heure', async () => {
    const { fetchImpl, calls } = fakeFetch(videoBody());
    let clock = 0;
    const youtube = createYoutube({ apiKey: 'K', fetchImpl, now: () => clock });
    await youtube.video('VHoT4N43jK8');
    clock += 59 * 60 * 1000;
    await youtube.video('VHoT4N43jK8');
    expect(calls).toHaveLength(1);
    clock += 2 * 60 * 1000;
    await youtube.video('VHoT4N43jK8');
    expect(calls).toHaveLength(2);
  });
});

describe('durée ISO 8601 de l’API', () => {
  it('convertit les formats courants', () => {
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT3M6S')).toBe(186);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('P1DT1H')).toBe(90_000);
  });

  it('renvoie 0 pour une durée absente ou illisible', () => {
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('trois minutes')).toBe(0);
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

  it('continue de fonctionner quand beaucoup d’adresses différentes passent', () => {
    const limiter = createSearchLimiter(1);
    for (let i = 0; i < 6000; i++) limiter.allow(`10.0.${Math.floor(i / 256)}.${i % 256}`, 0);
    // Les fenêtres closes sont retirées : une nouvelle adresse est acceptée, et la première est de nouveau libre.
    expect(limiter.allow('192.168.0.1', 120_000)).toBe(true);
    expect(limiter.allow('10.0.0.0', 120_000)).toBe(true);
  });
});
