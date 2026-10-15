import { describe, expect, it } from 'vitest';
import { imiteMoi, imiteSettingsSchema, type ImiteState } from '@partyhub/games';
import type { GameContext, PlayerRef } from '@partyhub/shared';

/** Contexte déterministe : les valeurs de `randoms` sont consommées dans l'ordre (puis 0.5). */
function makeCtx(randoms: number[] = [], connected: string[] = []) {
  const queue = [...randoms];
  const timers = new Map<string, number>();
  const ctx: GameContext & { timers: Map<string, number> } = {
    now: () => 1_000,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: () => (queue.length ? queue.shift()! : 0.5),
    connectedPlayerIds: () => connected,
    timers,
  };
  return ctx;
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/';
const WEBM = 'data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAG';

function players(n: number): PlayerRef[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Joueur ${i + 1}` }));
}

function setup(level: string, count: number, who = 3, randoms: number[] = []) {
  const settings = imiteSettingsSchema.parse({ level, rounds: count, answerSeconds: 40 });
  const ctx = makeCtx(
    randoms,
    players(who).map((p) => p.id),
  );
  const state = imiteMoi.initialize(settings, players(who), ctx);
  return { ctx, state };
}

function act(state: ImiteState, id: string, type: string, payload: unknown, ctx: GameContext): ImiteState {
  const result = imiteMoi.handleAction(state, { id, name: id }, type, payload, ctx);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('Imite-moi : réglages et consignes', () => {
  it('refuse les réglages hors bornes', () => {
    expect(imiteSettingsSchema.safeParse({ rounds: 11 }).success).toBe(false);
    expect(imiteSettingsSchema.safeParse({ answerSeconds: 5 }).success).toBe(false);
    expect(imiteSettingsSchema.safeParse({ level: 'inconnu' }).success).toBe(false);
  });

  it('un niveau unique ne tire que des manches de ce mode', () => {
    const { state } = setup('grimace', 4);
    expect(state.plan.map((r) => r.mode)).toEqual(['grimace', 'grimace', 'grimace', 'grimace']);
  });

  it('le mélange alterne galerie, grimace et cri', () => {
    const { state } = setup('melange', 6);
    expect(state.plan.map((r) => r.mode)).toEqual(['galerie', 'grimace', 'cri', 'galerie', 'grimace', 'cri']);
  });

  it('le niveau cri tire des consignes sonores', () => {
    const { state } = setup('cri', 2);
    expect(state.plan.every((r) => r.mode === 'cri' && r.art === null)).toBe(true);
  });

  it('une manche grimace porte une illustration', () => {
    const { state } = setup('grimace', 1);
    expect(state.plan[0]!.art).not.toBeNull();
  });
});

describe('Imite-moi : validation des réponses', () => {
  it('accepte une image JPEG, PNG ou WebP en data URL', () => {
    expect(imiteMoi.actions.photo!.safeParse({ dataUrl: JPG }).success).toBe(true);
    expect(imiteMoi.actions.photo!.safeParse({ dataUrl: PNG }).success).toBe(true);
  });

  it('refuse un contenu qui n’est pas une image', () => {
    expect(imiteMoi.actions.photo!.safeParse({ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }).success).toBe(false);
    expect(imiteMoi.actions.photo!.safeParse({ dataUrl: 'https://exemple.test/x.jpg' }).success).toBe(false);
  });

  it('refuse une réponse trop lourde pour une action Socket.IO', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(61_000)}`;
    expect(imiteMoi.actions.photo!.safeParse({ dataUrl: huge }).success).toBe(false);
  });

  it('accepte un son WebM ou MP4, refuse une image en son', () => {
    expect(imiteMoi.actions.sound!.safeParse({ dataUrl: WEBM }).success).toBe(true);
    expect(imiteMoi.actions.sound!.safeParse({ dataUrl: JPG }).success).toBe(false);
  });
});

describe('Imite-moi : déroulement d’une manche', () => {
  it('démarre en phase de réponse et programme le délai', () => {
    const { state, ctx } = setup('galerie', 1);
    const result = imiteMoi.start(state, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.phase).toBe('submit');
    expect(ctx.timers.get('write-timeout')).toBe(40_000);
  });

  it('refuse une photo quand la manche demande un son', () => {
    const { state, ctx } = setup('cri', 1);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    const result = imiteMoi.handleAction(started.state, { id: 'p1', name: 'p1' }, 'photo', { dataUrl: JPG }, ctx);
    expect(result.ok).toBe(false);
  });

  it('refuse un son quand la manche demande une photo', () => {
    const { state, ctx } = setup('grimace', 1);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    const result = imiteMoi.handleAction(started.state, { id: 'p1', name: 'p1' }, 'sound', { dataUrl: WEBM }, ctx);
    expect(result.ok).toBe(false);
  });

  it('refuse une seconde réponse du même joueur', () => {
    const { state, ctx } = setup('galerie', 1);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    const once = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    const again = imiteMoi.handleAction(once, { id: 'p1', name: 'p1' }, 'photo', { dataUrl: PNG }, ctx);
    expect(again.ok).toBe(false);
  });

  it('passe au vote dès que tous les joueurs connectés ont répondu', () => {
    const { state, ctx } = setup('galerie', 1, 3);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    let s = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    s = act(s, 'p2', 'photo', { dataUrl: JPG }, ctx);
    expect(s.phase).toBe('submit');
    s = act(s, 'p3', 'photo', { dataUrl: JPG }, ctx);
    expect(s.phase).toBe('vote');
    expect(s.options.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('le délai de réponse ouvre le vote même si tout le monde n’a pas répondu', () => {
    const { state, ctx } = setup('galerie', 1, 3);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    let s = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    s = act(s, 'p2', 'photo', { dataUrl: PNG }, ctx);
    const after = imiteMoi.onTimer(s, 'write-timeout', ctx);
    expect(after.phase).toBe('vote');
    expect(after.options.sort()).toEqual(['p1', 'p2']);
  });

  it('avec une seule réponse, rien à départager : on passe directement à la révélation', () => {
    const { state, ctx } = setup('galerie', 1, 3);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    const s = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    const after = imiteMoi.onTimer(s, 'write-timeout', ctx);
    expect(after.phase).toBe('reveal');
  });
});

describe('Imite-moi : vote anonyme et points', () => {
  function toVote(level: string, answers: Record<string, string>, randoms: number[] = []) {
    const { state, ctx } = setup(level, 1, 3, randoms);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    let s = started.state;
    for (const [id, dataUrl] of Object.entries(answers)) {
      s = act(s, id, level === 'cri' ? 'sound' : 'photo', { dataUrl }, ctx);
    }
    return { s, ctx };
  }

  it('la vue de vote ne montre jamais les auteurs des réponses', () => {
    const { s } = toVote('galerie', { p1: JPG, p2: PNG, p3: JPG });
    const view = imiteMoi.getPublicState(s) as { entries: Array<Record<string, unknown>> };
    expect(view.entries.map((e) => e.dataUrl)).toContain(PNG);
    expect(JSON.stringify(view.entries)).not.toMatch(/p1|p2|p3|Joueur|author/);
  });

  it('pendant la réponse, les réponses ne sont pas encore visibles', () => {
    const { state, ctx } = setup('galerie', 1, 3);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    const s = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    expect(JSON.stringify(imiteMoi.getPublicState(s))).not.toContain('base64');
    expect(JSON.stringify(imiteMoi.getPlayerState(s, 'p2'))).not.toContain('base64');
  });

  it('on ne peut pas voter pour sa propre réponse', () => {
    const { s, ctx } = toVote('galerie', { p1: JPG, p2: PNG, p3: JPG }, [0.5]);
    const own = s.options.indexOf('p1');
    const result = imiteMoi.handleAction(s, { id: 'p1', name: 'p1' }, 'vote', { option: own }, ctx);
    expect(result.ok).toBe(false);
  });

  it('chaque vote reçu rapporte 100 points à son auteur', () => {
    const { s, ctx } = toVote('galerie', { p1: JPG, p2: PNG, p3: JPG }, [0.5]);
    // p1 et p3 votent pour p2 ; p2 vote pour p1. Tout le monde doit voter pour clore la manche.
    const plan: Array<[voter: string, author: string]> = [
      ['p1', 'p2'],
      ['p3', 'p2'],
      ['p2', 'p1'],
    ];
    let next = s;
    for (const [voter, author] of plan) {
      const result = imiteMoi.handleAction(
        next,
        { id: voter, name: voter },
        'vote',
        { option: next.options.indexOf(author) },
        ctx,
      );
      if (!result.ok) throw new Error(result.error);
      next = result.state;
    }
    expect(next.phase).toBe('reveal');
    expect(next.points.p2).toBe(200);
    expect(next.points.p1).toBe(100);
    expect(next.points.p3).toBe(0);
  });

  it('la révélation nomme les auteurs', () => {
    const { s, ctx } = toVote('galerie', { p1: JPG, p2: PNG, p3: JPG }, [0.5]);
    const revealed = imiteMoi.nextRound(s, ctx);
    expect(revealed.phase).toBe('reveal');
    const view = imiteMoi.getPublicState(revealed) as { results: Array<{ author: string }> };
    expect(view.results.map((r) => r.author).sort()).toEqual(['Joueur 1', 'Joueur 2', 'Joueur 3']);
  });

  it('la vue privée d’un joueur ne contient aucune réponse', () => {
    const { s } = toVote('galerie', { p1: JPG, p2: PNG, p3: JPG });
    expect(JSON.stringify(imiteMoi.getPlayerState(s, 'p1'))).not.toContain('base64');
  });
});

describe('Imite-moi : enchaînement des manches', () => {
  it('après la révélation, la manche suivante s’ouvre, puis la partie se termine', () => {
    const { state, ctx } = setup('grimace', 2, 2);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    let s = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    s = act(s, 'p2', 'photo', { dataUrl: PNG }, ctx);
    s = imiteMoi.nextRound(s, ctx);
    expect(s.phase).toBe('reveal');
    s = imiteMoi.onTimer(s, 'reveal-next', ctx);
    expect(s.phase).toBe('submit');
    expect(s.index).toBe(1);
    expect(Object.keys(s.entries)).toEqual([]);
    s = imiteMoi.nextRound(s, ctx);
    s = imiteMoi.onTimer(s, 'reveal-next', ctx);
    expect(s.phase).toBe('final');
    expect(imiteMoi.isFinished(s)).toBe(true);
    // Les réponses ne survivent pas à la partie.
    expect(s.entries).toEqual({});
    expect(s.options).toEqual([]);
  });

  it('le vote s’ouvre quand les joueurs connectés ont répondu : un joueur déconnecté ne bloque pas', () => {
    const { state, ctx } = setup('galerie', 1, 3);
    const started = imiteMoi.start(state, ctx);
    if (!started.ok) throw new Error('start');
    let s = act(started.state, 'p1', 'photo', { dataUrl: JPG }, ctx);
    const connected = makeCtx([], ['p1', 'p2']);
    s = act(s, 'p2', 'photo', { dataUrl: PNG }, connected);
    expect(s.phase).toBe('vote');
  });

  it('les robots proposent une photo, sauf sur les manches de cri', () => {
    const photo = setup('galerie', 1, 2);
    const started = imiteMoi.start(photo.state, photo.ctx);
    if (!started.ok) throw new Error('start');
    const suggestion = imiteMoi.suggest!(started.state, 'p1', () => 0.5);
    expect(suggestion?.type).toBe('photo');
    expect(imiteMoi.actions.photo!.safeParse(suggestion?.payload).success).toBe(true);

    const sound = setup('cri', 1, 2);
    const startedSound = imiteMoi.start(sound.state, sound.ctx);
    if (!startedSound.ok) throw new Error('start');
    expect(imiteMoi.suggest!(startedSound.state, 'p1', () => 0.5)).toBeNull();
  });
});
