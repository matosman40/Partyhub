import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import {
  karaoke,
  runKaraokeJob,
  setKaraokeYoutube,
  type KaraokeState,
  type KaraokeYoutube,
} from '../karaoke/module.js';

const players: PlayerRef[] = [
  { id: 'p1', name: 'Léa' },
  { id: 'p2', name: 'Tom' },
  { id: 'p3', name: 'Ana' },
];

const hit = { videoId: 'VHoT4N43jK8', title: 'Alors on danse', channel: 'Stromae' };
const video = { ...hit, durationSec: 212 };

function makeCtx() {
  let clock = 0;
  const ctx: GameContext = {
    now: () => clock,
    schedule: () => undefined,
    cancel: () => undefined,
    random: () => 0.42,
    connectedPlayerIds: () => ['p1', 'p2', 'p3'],
  };
  return { ctx, advance: (ms: number) => (clock += ms) };
}

function start() {
  const env = makeCtx();
  const initial = karaoke.initialize(karaoke.defaultSettings, players, env.ctx);
  const started = karaoke.start(initial, env.ctx);
  if (!started.ok) throw new Error(started.error);
  const state = started.state as KaraokeState;
  return { env, state, singer: state.order[0]! };
}

function act(state: KaraokeState, env: ReturnType<typeof makeCtx>, playerId: string, type: string, payload: unknown) {
  const result = karaoke.handleAction(state, { id: playerId, name: playerId }, type, payload, env.ctx);
  if (!result.ok) throw new Error(result.error);
  return result.state as KaraokeState;
}

function refusedWith(
  state: KaraokeState,
  env: ReturnType<typeof makeCtx>,
  playerId: string,
  type: string,
  payload: unknown,
): string {
  const result = karaoke.handleAction(state, { id: playerId, name: playerId }, type, payload, env.ctx);
  if (result.ok) throw new Error(`${type} aurait dû être refusé`);
  return result.error;
}

/** Le serveur exécute le travail en attente, puis rend son résultat au moteur. */
function serve(state: KaraokeState, env: ReturnType<typeof makeCtx>, value: unknown): KaraokeState {
  const job = karaoke.pendingJob!(state);
  if (!job) throw new Error('aucun travail en attente');
  return karaoke.completeJob!(state, job.id, { ok: true, value }, env.ctx) as KaraokeState;
}

function lookupOf(state: KaraokeState, playerId: string) {
  return (karaoke.getPlayerState(state, playerId) as { lookup: { pending: string | null; answer: unknown } }).lookup;
}

describe('karaoké : recherche et vérification YouTube par le serveur', () => {
  it('le chanteur demande une recherche : elle part au serveur, puis la réponse arrive dans son état', () => {
    const { env, state, singer } = start();
    const asked = act(state, env, singer, 'search', { query: 'Stromae' });

    expect(karaoke.pendingJob!(asked)).toMatchObject({ kind: 'youtube-search', input: { query: 'Stromae' } });
    expect(lookupOf(asked, singer).pending).toBe('search');

    const answered = serve(asked, env, { ok: true, value: [hit] });
    expect(karaoke.pendingJob!(answered)).toBeNull();
    expect(lookupOf(answered, singer)).toEqual({ pending: null, answer: { kind: 'search', hits: [hit] } });
  });

  it('seul le chanteur cherche, et une seule demande à la fois', () => {
    const { env, state, singer } = start();
    const other = state.order[1]!;
    expect(refusedWith(state, env, other, 'search', { query: 'Stromae' })).toMatch(/Seul le chanteur/);

    const asked = act(state, env, singer, 'search', { query: 'Stromae' });
    expect(refusedWith(asked, env, singer, 'search', { query: 'Stromae' })).toMatch(/déjà en cours/);
  });

  it('pas de recherche ni de vérification hors du choix de la chanson', () => {
    const { env, state, singer } = start();
    const singing = act(state, env, singer, 'sing', { videoId: hit.videoId, title: hit.title, channel: '', startSec: 0 });
    expect(refusedWith(singing, env, singer, 'search', { query: 'Stromae' })).toMatch(/pendant le choix/);
  });

  it('une réponse qui arrive après le passage est ignorée', () => {
    const { env, state, singer } = start();
    const asked = act(state, env, singer, 'search', { query: 'Stromae' });
    const job = karaoke.pendingJob!(asked)!;
    const singing = act(asked, env, singer, 'sing', { videoId: hit.videoId, title: hit.title, channel: '', startSec: 0 });
    const late = karaoke.completeJob!(singing, job.id, { ok: true, value: { ok: true, value: [hit] } }, env.ctx) as KaraokeState;
    expect(late.answers[singer]).toBeUndefined();
    expect(late.requests).toHaveLength(0);
  });

  it('une vérification donne la vidéo, que le chanteur peut ensuite chanter', () => {
    const { env, state, singer } = start();
    const asked = act(state, env, singer, 'check', { videoId: hit.videoId });
    expect(karaoke.pendingJob!(asked)).toMatchObject({ kind: 'youtube-check', input: { videoId: hit.videoId } });

    const checked = serve(asked, env, { ok: true, value: video });
    expect(lookupOf(checked, singer).answer).toEqual({ kind: 'check', video, unverified: false });

    const singing = act(checked, env, singer, 'sing', { videoId: hit.videoId, title: hit.title, channel: '', startSec: 45 });
    expect(singing.phase).toBe('sing');
  });

  it('sans clé sur le serveur, un lien collé reste utilisable, sans durée connue', () => {
    const { env, state, singer } = start();
    const asked = act(state, env, singer, 'check', { videoId: hit.videoId });
    const checked = serve(asked, env, { ok: false, code: 'disabled', message: 'YouTube n’est pas activé.' });
    expect(lookupOf(checked, singer).answer).toEqual({
      kind: 'check',
      video: { videoId: hit.videoId, title: `Vidéo ${hit.videoId}`, channel: '', durationSec: null },
      unverified: true,
    });
  });

  it('une erreur YouTube est affichée au chanteur', () => {
    const { env, state, singer } = start();
    const asked = act(state, env, singer, 'search', { query: 'Stromae' });
    const failed = serve(asked, env, { ok: false, code: 'quota', message: 'YouTube a atteint sa limite pour aujourd’hui.' });
    expect(lookupOf(failed, singer).answer).toEqual({
      kind: 'error',
      message: 'YouTube a atteint sa limite pour aujourd’hui.',
    });
  });

  it('un résultat illisible devient une erreur, sans rien casser', () => {
    const { env, state, singer } = start();
    const asked = act(state, env, singer, 'search', { query: 'Stromae' });
    const job = karaoke.pendingJob!(asked)!;
    const broken = karaoke.completeJob!(asked, job.id, { ok: true, value: 'n’importe quoi' }, env.ctx) as KaraokeState;
    expect(lookupOf(broken, singer).answer).toMatchObject({ kind: 'error' });
  });

  it('plafond de demandes par passage', () => {
    const { env, state, singer } = start();
    let current = state;
    for (let i = 0; i < 8; i++) {
      current = serve(act(current, env, singer, 'search', { query: `essai ${i}` }), env, { ok: true, value: [] });
    }
    expect(refusedWith(current, env, singer, 'search', { query: 'de trop' })).toMatch(/Trop de recherches/);
  });

  it('une requête trop courte est refusée sans travail', () => {
    const { env, state, singer } = start();
    expect(refusedWith(state, env, singer, 'search', { query: 'a' })).toMatch(/deux caractères/);
    expect(karaoke.pendingJob!(state)).toBeNull();
  });

  it('sans fournisseur YouTube, le travail répond « désactivé » sans rien appeler', async () => {
    setKaraokeYoutube(null);
    await expect(runKaraokeJob({ id: 'x', kind: 'youtube-search', input: { query: 'Stromae' } })).resolves.toMatchObject({
      ok: false,
      code: 'disabled',
    });
  });

  it('le travail appelle le fournisseur du serveur, puis rend son résultat', async () => {
    const calls: string[] = [];
    const provider: KaraokeYoutube = {
      async search(query) {
        calls.push(`search:${query}`);
        return { ok: true, value: [hit] };
      },
      async video(videoId) {
        calls.push(`video:${videoId}`);
        return { ok: true, value: video };
      },
    };
    setKaraokeYoutube(provider);
    try {
      await expect(runKaraokeJob({ id: 'a', kind: 'youtube-search', input: { query: 'Stromae' } })).resolves.toEqual({
        ok: true,
        value: [hit],
      });
      await expect(runKaraokeJob({ id: 'b', kind: 'youtube-check', input: { videoId: hit.videoId } })).resolves.toEqual({
        ok: true,
        value: video,
      });
      expect(calls).toEqual([`search:Stromae`, `video:${hit.videoId}`]);
    } finally {
      setKaraokeYoutube(null);
    }
  });
});
