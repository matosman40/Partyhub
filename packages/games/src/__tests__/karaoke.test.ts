import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { karaoke, KARAOKE_CLIP_MAX_CHARS, type KaraokeState } from '../karaoke/module.js';

const players: PlayerRef[] = [
  { id: 'p1', name: 'Léa' },
  { id: 'p2', name: 'Tom' },
  { id: 'p3', name: 'Ana' },
];

const song = { videoId: 'VHoT4N43jK8', title: 'Alors on danse', channel: 'Stromae', startSec: 45 };
const clip = `data:audio/webm;codecs=opus;base64,${'AAAA'.repeat(20)}`;

function makeCtx(connected: string[] = ['p1', 'p2', 'p3']) {
  const timers = new Map<string, number>();
  let clock = 0;
  const ctx: GameContext = {
    now: () => clock,
    schedule: (key, delayMs) => {
      timers.set(key, delayMs);
    },
    cancel: (key) => {
      timers.delete(key);
    },
    random: () => 0.42,
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers, advance: (ms: number) => (clock += ms) };
}

function start(connected?: string[]) {
  const env = makeCtx(connected);
  const initial = karaoke.initialize(karaoke.defaultSettings, players, env.ctx);
  const started = karaoke.start(initial, env.ctx);
  if (!started.ok) throw new Error(started.error);
  return { env, state: started.state as KaraokeState };
}

function act(
  state: KaraokeState,
  env: ReturnType<typeof makeCtx>,
  playerId: string,
  type: string,
  payload: unknown,
): KaraokeState {
  const result = karaoke.handleAction(state, { id: playerId, name: playerId }, type, payload, env.ctx);
  if (!result.ok) throw new Error(result.error);
  return result.state as KaraokeState;
}

function refused(
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

/** Fait chanter le joueur dont c’est le tour, puis envoie la voix. */
function singTurn(state: KaraokeState, env: ReturnType<typeof makeCtx>): KaraokeState {
  const singer = state.order[state.index]!;
  let next = act(state, env, singer, 'sing', song);
  next = act(next, env, singer, 'recording', { dataUrl: clip });
  // Le rejeu se termine tout seul : on passe au vote.
  return karaoke.onTimer(next, 'replay-next', env.ctx);
}

describe('Karaoké : lancement', () => {
  it('refuse de démarrer seul', () => {
    const env = makeCtx(['p1']);
    const initial = karaoke.initialize(karaoke.defaultSettings, [players[0]!], env.ctx);
    const result = karaoke.start(initial, env.ctx);
    expect(result.ok).toBe(false);
  });

  it('tire un ordre de passage où chacun chante une fois', () => {
    const { state } = start();
    expect(state.phase).toBe('pick');
    expect([...state.order].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(state.index).toBe(0);
  });
});

describe('Karaoké : choix de la chanson', () => {
  it('seul le chanteur peut choisir, et une vidéo invalide est refusée', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const other = state.order.find((id) => id !== singer)!;
    expect(refused(state, env, other, 'sing', song)).toContain('tour');
    expect(refused(state, env, singer, 'sing', { ...song, videoId: 'pas une vidéo' })).toContain('invalide');
    expect(refused(state, env, singer, 'sing', { ...song, startSec: -4 })).toContain('invalide');
  });

  it('le passage démarre sur l’écran, et le chanteur est le seul à pouvoir envoyer sa voix', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const sung = act(state, env, singer, 'sing', song);
    expect(sung.phase).toBe('sing');
    expect(sung.song).toEqual(song);
    const other = state.order[1]!;
    expect(refused(sung, env, other, 'recording', { dataUrl: clip })).toBeTruthy();
  });

  it('refuse une voix trop lourde ou qui n’est pas du son', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const sung = act(state, env, singer, 'sing', song);
    const heavy = `data:audio/webm;base64,${'A'.repeat(KARAOKE_CLIP_MAX_CHARS)}`;
    expect(refused(sung, env, singer, 'recording', { dataUrl: heavy })).toBeTruthy();
    expect(refused(sung, env, singer, 'recording', { dataUrl: 'data:image/png;base64,AAAA' })).toContain('invalide');
  });
});

describe('Karaoké : la voix reste à l’écran', () => {
  it('la voix n’est jamais dans la vue des téléphones, et seul l’écran la reçoit pendant le rejeu', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const sung = act(state, env, singer, 'sing', song);
    const replay = act(sung, env, singer, 'recording', { dataUrl: clip });
    expect(replay.phase).toBe('replay');

    const publicJson = JSON.stringify(karaoke.getPublicState(replay));
    expect(publicJson).not.toContain('data:audio');
    expect(publicJson).not.toContain(song.videoId);
    expect(JSON.stringify(karaoke.getPlayerState(replay, 'p2'))).not.toContain('data:audio');

    const host = karaoke.getHostState(replay) as {
      clip: string | null;
      muted: boolean;
      media: { source: { videoId: string } };
    };
    expect(host.clip).toBe(clip);
    expect(host.muted).toBe(true);
    expect(host.media.source.videoId).toBe(song.videoId);
  });

  it('le clip est retiré de la vue de l’écran après le rejeu', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const replay = act(act(state, env, singer, 'sing', song), env, singer, 'recording', { dataUrl: clip });
    const voting = karaoke.onTimer(replay, 'replay-next', env.ctx);
    expect(voting.phase).toBe('vote');
    expect((karaoke.getHostState(voting) as { clip: string | null }).clip).toBeNull();
  });
});

describe('Karaoké : notation', () => {
  it('le chanteur ne note pas sa propre prestation, et une note n’est comptée qu’une fois', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const voting = karaoke.onTimer(
      act(act(state, env, singer, 'sing', song), env, singer, 'recording', { dataUrl: clip }),
      'replay-next',
      env.ctx,
    );
    expect(refused(voting, env, singer, 'rate', { stars: 5 })).toContain('propre');
    const listener = state.order[1]!;
    const rated = act(voting, env, listener, 'rate', { stars: 4 });
    expect(refused(rated, env, listener, 'rate', { stars: 2 })).toContain('déjà');
  });

  it('une fois toutes les notes reçues, le passage est révélé et rapporte la moyenne en points', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    let current = karaoke.onTimer(
      act(act(state, env, singer, 'sing', song), env, singer, 'recording', { dataUrl: clip }),
      'replay-next',
      env.ctx,
    );
    const [a, b] = state.order.filter((id) => id !== singer);
    current = act(current, env, a!, 'rate', { stars: 5 });
    current = act(current, env, b!, 'rate', { stars: 4 });
    expect(current.phase).toBe('reveal');
    expect(current.average).toBe(4.5);
    expect(current.points[singer]).toBe(45);
    expect(current.gains).toEqual({ [singer]: 45 });
  });

  it('un passage sans note ne rapporte rien', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const voting = karaoke.onTimer(
      act(act(state, env, singer, 'sing', song), env, singer, 'recording', { dataUrl: clip }),
      'replay-next',
      env.ctx,
    );
    const revealed = karaoke.onTimer(voting, 'vote-timeout', env.ctx);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.average).toBeNull();
    expect(revealed.points[singer]).toBe(0);
  });
});

describe('Karaoké : enchaînement des tours', () => {
  it('passe au chanteur suivant après la révélation, puis termine quand chacun a chanté', () => {
    const { state, env } = start();
    let current = state;
    for (let turn = 0; turn < players.length; turn++) {
      expect(current.phase).toBe('pick');
      current = singTurn(current, env);
      current = karaoke.onTimer(current, 'vote-timeout', env.ctx);
      expect(current.phase).toBe('reveal');
      current = karaoke.onTimer(current, 'reveal-next', env.ctx);
    }
    expect(current.phase).toBe('final');
    expect(karaoke.isFinished(current)).toBe(true);
  });

  it('un chanteur qui ne choisit pas à temps passe son tour sans point', () => {
    const { state, env } = start();
    const revealed = karaoke.onTimer(state, 'pick-timeout', env.ctx);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.gains).toEqual({});
    const next = karaoke.onTimer(revealed, 'reveal-next', env.ctx);
    expect(next.phase).toBe('pick');
    expect(next.index).toBe(1);
  });

  it('si la voix n’arrive pas, le vote a lieu sans rejeu', () => {
    const { state, env } = start();
    const singer = state.order[0]!;
    const sung = act(state, env, singer, 'sing', song);
    const voting = karaoke.onTimer(sung, 'sing-timeout', env.ctx);
    expect(voting.phase).toBe('vote');
    expect(voting.clip).toBeNull();
  });

  it('les minuteurs sont nettoyés en fin de partie', () => {
    const { state, env } = start();
    const finished = karaoke.end(state, env.ctx);
    expect(finished.phase).toBe('final');
    expect(env.timers.size).toBe(0);
  });
});
