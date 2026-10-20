import { afterEach, describe, expect, it } from 'vitest';
import { setKaraokeYoutube, type KaraokeYoutube } from '@partyhub/games';
import type { GameContext, GameJob } from '@partyhub/shared';
import { codeJobRunner } from '../code-games/ai-jobs.js';
import { karaokeYoutube } from '../youtube/karaoke.js';
import { YOUTUBE_ERROR_MESSAGES, YoutubeError, type Youtube } from '../youtube/search.js';

const ctx = {} as GameContext;
const signal = new AbortController().signal;
const hit = { videoId: 'VHoT4N43jK8', title: 'Alors on danse', channel: 'Stromae' };

afterEach(() => setKaraokeYoutube(null));

describe('karaoké en jeu de code : travaux YouTube', () => {
  it('la recherche du karaoké passe même si l’IA n’est pas activée pour le jeu', async () => {
    const provider: KaraokeYoutube = {
      async search() {
        return { ok: true, value: [hit] };
      },
      async video() {
        return { ok: false, code: 'unused', message: 'non utilisé' };
      },
    };
    setKaraokeYoutube(provider);
    const run = codeJobRunner('karaoke', () => false);
    const job: GameJob = { id: 'yt-1', kind: 'youtube-search', input: { query: 'Stromae' } };
    await expect(run(job, ctx, signal)).resolves.toEqual({ ok: true, value: [hit] });
  });

  it('les travaux d’IA restent soumis au réglage d’IA du jeu', async () => {
    const run = codeJobRunner('aventure-ia', () => false);
    const job: GameJob = { id: 'ia-1', kind: 'roster', input: {} };
    await expect(run(job, ctx, signal)).rejects.toThrow(/IA n’est pas activée/);
  });

  it('un type de travail inconnu pour le karaoké est refusé', async () => {
    const run = codeJobRunner('karaoke', () => true);
    const job: GameJob = { id: 'x', kind: 'roster', input: {} };
    await expect(run(job, ctx, signal)).rejects.toThrow(/inconnu/);
  });
});

describe('accès YouTube du karaoké', () => {
  it('une erreur YouTube devient un résultat avec le message en français', async () => {
    const youtube = {
      enabled: true,
      async search() {
        throw new YoutubeError('quota');
      },
      async video() {
        throw new YoutubeError('notEmbeddable');
      },
    } as unknown as Youtube;
    const access = karaokeYoutube(youtube);
    await expect(access.search('Stromae')).resolves.toEqual({
      ok: false,
      code: 'quota',
      message: YOUTUBE_ERROR_MESSAGES.quota,
    });
    await expect(access.video(hit.videoId)).resolves.toEqual({
      ok: false,
      code: 'notEmbeddable',
      message: YOUTUBE_ERROR_MESSAGES.notEmbeddable,
    });
  });

  it('une panne inconnue devient « injoignable », sans lever d’erreur', async () => {
    const youtube = {
      enabled: true,
      async search() {
        throw new Error('réseau coupé');
      },
      async video() {
        return { videoId: hit.videoId, title: hit.title, channel: hit.channel, durationSec: 212 };
      },
    } as unknown as Youtube;
    await expect(karaokeYoutube(youtube).search('Stromae')).resolves.toEqual({
      ok: false,
      code: 'unavailable',
      message: YOUTUBE_ERROR_MESSAGES.unavailable,
    });
  });

  it('une vidéo vérifiée est rendue telle quelle', async () => {
    const video = { ...hit, durationSec: 212 };
    const youtube = {
      enabled: true,
      async search() {
        return [hit];
      },
      async video() {
        return video;
      },
    } as unknown as Youtube;
    await expect(karaokeYoutube(youtube).video(hit.videoId)).resolves.toEqual({ ok: true, value: video });
  });
});
