import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { mediaQuizDefinitionSchema } from '@partyhub/shared';
import { createMediaGame, seededRandom } from '@partyhub/games';

function makeCtx(connected: string[]) {
  let clock = 0;
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => clock,
    schedule: (key, ms) => timers.set(key, clock + ms),
    cancel: (key) => timers.delete(key),
    random: seededRandom(5),
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers, advance: (ms: number) => (clock += ms) };
}

const ASSET = 'f'.repeat(32);
const definition = mediaQuizDefinitionSchema.parse({
  mode: 'sous-titres',
  kind: 'film',
  name: 'Film étranger',
  rules: { questionCount: 2, answerSeconds: 30, speedBonus: false },
  items: [
    {
      id: 'scene-1',
      answer: 'Je suis en retard',
      aliases: [],
      detail: 'Japonais',
      source: { type: 'asset', assetId: ASSET, mediaKind: 'video' },
      startSec: 3,
      durationSec: 8,
    },
    {
      id: 'scene-2',
      answer: '',
      aliases: [],
      detail: '',
      source: { type: 'youtube', videoId: 'abcdefghijk' },
      startSec: 0,
      durationSec: 6,
    },
  ],
});

const alice: PlayerRef = { id: 'a', name: 'Alice' };
const bruno: PlayerRef = { id: 'b', name: 'Bruno' };

describe('Sous-titres', () => {
  it('une référence de traduction est facultative en mode sous-titres, obligatoire en mode devine', () => {
    const devine = { ...definition, mode: 'devine' as const };
    const result = mediaQuizDefinitionSchema.safeParse(devine);
    expect(result.success).toBe(false);
  });

  it('déroule écriture, vote anonyme puis révélation avec des points', () => {
    const { ctx, timers } = makeCtx(['a', 'b']);
    const module = createMediaGame(definition, { id: 'media-test' });
    let s = module.initialize(module.defaultSettings, [alice, bruno], ctx);
    expect(module.getPublicState(s).mode).toBe('sous-titres');

    const started = module.start(s, ctx);
    if (!started.ok) throw new Error(started.error);
    s = started.state;
    expect(timers.has('write-timeout')).toBe(true);

    // Pendant l'écriture, l'indice est public, mais la traduction de référence ne l'est pas.
    const writing = module.getPublicState(s) as Record<string, unknown>;
    expect(writing.phase).toBe('write');
    expect(writing.hint).toBe('Japonais');
    expect(JSON.stringify(writing)).not.toContain('retard');

    const a1 = module.handleAction(s, alice, 'caption', { text: 'Désolé, je suis en retard' }, ctx);
    if (!a1.ok) throw new Error(a1.error);
    s = a1.state;
    // Un joueur ne peut envoyer qu'une réplique.
    expect(module.handleAction(s, alice, 'caption', { text: 'Encore' }, ctx).ok).toBe(false);

    const b1 = module.handleAction(s, bruno, 'caption', { text: 'Le train, toujours le train' }, ctx);
    if (!b1.ok) throw new Error(b1.error);
    s = b1.state;
    expect(s.phase).toBe('vote');

    // Anonymat : les répliques sont visibles, les auteurs ne le sont pas.
    const voting = module.getPublicState(s) as { options: string[] };
    expect(voting.options.sort()).toEqual(['Désolé, je suis en retard', 'Le train, toujours le train'].sort());
    // Le classement affiche les pseudos, mais les répliques proposées n'indiquent pas leur auteur.
    expect(voting.options.join(' ')).not.toMatch(/Alice|Bruno/);

    // On ne vote pas pour sa propre réplique.
    const mine = s.options.indexOf('a');
    expect(module.handleAction(s, alice, 'vote', { option: mine }, ctx).ok).toBe(false);
    const theirs = s.options.indexOf('b');
    const v1 = module.handleAction(s, alice, 'vote', { option: theirs }, ctx);
    if (!v1.ok) throw new Error(v1.error);
    s = v1.state;
    const v2 = module.handleAction(s, bruno, 'vote', { option: s.options.indexOf('a') }, ctx);
    if (!v2.ok) throw new Error(v2.error);
    s = v2.state;

    expect(s.phase).toBe('reveal');
    expect(s.points).toEqual({ a: 100, b: 100 });
    const revealed = module.getPublicState(s) as { answer: string; results: Array<{ author: string }> };
    expect(revealed.answer).toBe('Je suis en retard');
    expect(revealed.results.map((r) => r.author).sort()).toEqual(['Alice', 'Bruno']);
  });

  it('une scène sans vote directement révélée, puis fin de partie', () => {
    const { ctx } = makeCtx(['a', 'b']);
    const module = createMediaGame(definition, { id: 'media-test' });
    let s = module.initialize({ questionCount: 1, answerSeconds: 20 }, [alice, bruno], ctx);
    s = (module.start(s, ctx) as { ok: true; state: typeof s }).state;
    // Personne n'écrit : le temps passe, on passe directement à la révélation.
    s = module.onTimer(s, 'write-timeout', ctx);
    expect(s.phase).toBe('reveal');
    s = module.onTimer(s, 'reveal-next', ctx);
    expect(s.phase).toBe('final');
    expect(module.isFinished(s)).toBe(true);
  });
});
