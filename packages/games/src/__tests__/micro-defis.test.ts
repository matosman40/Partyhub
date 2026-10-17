import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { microDefis, type MicroDefisState } from '../micro-defis/module.js';
import {
  buildSequence,
  judge,
  LATENCY_SLACK_MS,
  MICROGAME_IDS,
  MICROGAMES,
  pileMarker,
  PILE_PERIOD_MS,
  SUCCESS_POINTS,
  winningValue,
  losingValue,
} from '../micro-defis/microgames.js';

/** Contexte de test : horloge et minuteurs pilotés à la main. */
function clock(players: string[], connected = players) {
  let now = 1_000_000;
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, now + ms),
    cancel: (key) => void timers.delete(key),
    random: (() => {
      let seed = 42;
      return () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
    })(),
    connectedPlayerIds: () => connected,
  };
  return {
    ctx,
    timers,
    advance(ms: number) {
      now += ms;
    },
    /** Fait échéance à un minuteur (comme la salle le ferait à l'heure dite). */
    fire(state: MicroDefisState, key: string): MicroDefisState {
      now = Math.max(now, timers.get(key) ?? now);
      timers.delete(key);
      return microDefis.onTimer(state, key, ctx);
    },
  };
}

const ANA: PlayerRef = { id: 'ana', name: 'Ana' };
const LEO: PlayerRef = { id: 'leo', name: 'Léo' };

function started(rounds = 3) {
  const players = [ANA, LEO];
  const c = clock(['ana', 'leo']);
  const init = microDefis.initialize({ rounds }, players, c.ctx);
  const r = microDefis.start(init, c.ctx);
  if (!r.ok) throw new Error(r.error);
  return { c, s: r.state };
}

function playOf(s: MicroDefisState, c: ReturnType<typeof clock>): MicroDefisState {
  return c.fire(s, 'intro-end');
}

describe('Micro-Défis : règles des défis', () => {
  it('réussit la valeur attendue, et refuse ce qui est impossible dans le temps écoulé', () => {
    expect(judge(MICROGAMES.secousse, 12, 3000).success).toBe(true);
    // 60 secousses en 2 s : plus vite que la cadence possible.
    expect(judge(MICROGAMES.secousse, 60, 2000).success).toBe(false);
    expect(judge(MICROGAMES.secousse, 11, 6000).success).toBe(false);
    // Un maintien ne peut pas dépasser le temps écoulé (à la tolérance réseau près).
    expect(judge(MICROGAMES.equilibre, 3000, 1000).success).toBe(false);
    expect(judge(MICROGAMES.equilibre, 3000, 3000 + LATENCY_SLACK_MS).success).toBe(true);
    // Un tour complet ne se fait pas en moins de 0,7 s.
    expect(judge(MICROGAMES.tour, 360, 300).success).toBe(false);
    expect(judge(MICROGAMES.tour, 360, 2000).success).toBe(true);
    expect(judge(MICROGAMES.souffle, 1500, 1000).success).toBe(false);
    expect(judge(MICROGAMES.tapote, 20, 1000).success).toBe(false);
    expect(judge(MICROGAMES.tapote, 20, 4000).success).toBe(true);
  });

  it('donne plus de points quand on réussit vite', () => {
    // Douze secousses ne tiennent pas en moins de 1,4 s : le plus rapide possible est autour de 1,5 s.
    const vite = judge(MICROGAMES.secousse, 12, 1500);
    const lent = judge(MICROGAMES.secousse, 12, 5900);
    expect(vite.points).toBeGreaterThan(lent.points);
    expect(lent.points).toBeGreaterThanOrEqual(SUCCESS_POINTS);
    expect(vite.points).toBeLessThanOrEqual(SUCCESS_POINTS + 60);
    expect(judge(MICROGAMES.secousse, 3, 2000).points).toBe(0);
  });

  it('le défi « Pile » réussit au centre du curseur, et seulement là', () => {
    // Le curseur passe au centre à un quart et aux trois quarts de la période.
    expect(pileMarker(PILE_PERIOD_MS / 4)).toBeCloseTo(0.5);
    expect(pileMarker((3 * PILE_PERIOD_MS) / 4)).toBeCloseTo(0.5);
    expect(pileMarker(0)).toBeCloseTo(0);
    expect(pileMarker(PILE_PERIOD_MS / 2)).toBeCloseTo(1);
    expect(judge(MICROGAMES.pile, PILE_PERIOD_MS / 4, 1000).success).toBe(true);
    expect(judge(MICROGAMES.pile, 50, 1000).success).toBe(false);
    // Un temps négatif ou hors du défi ne compte pas.
    expect(judge(MICROGAMES.pile, -1, 1000).success).toBe(false);
    // Un appui au bon endroit du curseur, mais après la fin du défi : il ne compte pas.
    expect(judge(MICROGAMES.pile, 6300, 7000).success).toBe(false);
  });

  it('les robots réussissent avec la valeur gagnante, et échouent avec la valeur perdante', () => {
    for (const id of MICROGAME_IDS) {
      const game = MICROGAMES[id];
      expect(judge(game, winningValue(game), game.durationMs / 2).success).toBe(true);
      expect(judge(game, losingValue(game), game.durationMs / 2).success).toBe(false);
    }
  });
});

describe('Micro-Défis : suite des défis', () => {
  it('ne répète jamais le même défi de suite, et utilise tous les défis sur une longue partie', () => {
    const seq = buildSequence(30, () => Math.random());
    expect(seq).toHaveLength(30);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq).size).toBe(MICROGAME_IDS.length);
  });

  it('donne la même suite à partir du même tirage', () => {
    const a = buildSequence(8, () => 0.3);
    const b = buildSequence(8, () => 0.3);
    expect(a).toEqual(b);
  });
});

describe('Micro-Défis : déroulement d’une partie', () => {
  /** Une réponse envoyée après `afterMs` de défi (le temps passe, comme sur un vrai téléphone). */
  function answer(
    s: MicroDefisState,
    c: ReturnType<typeof clock>,
    player: PlayerRef,
    value: number,
    afterMs = 3000,
  ): MicroDefisState {
    c.advance(afterMs);
    const res = microDefis.handleAction(s, player, 'done', { value }, c.ctx);
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('enchaîne présentation, défi, bilan, puis termine après le dernier défi', () => {
    const { c, s: start } = started(2);
    expect(start.phase).toBe('intro');
    expect(microDefis.getPublicState(start)).toMatchObject({ phase: 'intro', round: 1, rounds: 2 });

    let s = playOf(start, c);
    expect(s.phase).toBe('play');
    const game = MICROGAMES[s.sequence[0]!];
    expect(microDefis.getPublicState(s)).toMatchObject({ microgame: { id: game.id, durationMs: game.durationMs } });

    s = c.fire(s, 'play-end');
    expect(s.phase).toBe('reveal');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('intro');
    expect(s.round).toBe(1);

    s = playOf(s, c);
    s = c.fire(s, 'play-end');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('final');
    expect(microDefis.isFinished(s)).toBe(true);
    expect(c.timers.size).toBe(0);
  });

  it('affiche le bilan dès que tous les joueurs connectés ont joué, sans attendre la fin du temps', () => {
    const { c, s: start } = started(2);
    const playing = playOf(start, c);
    const game = MICROGAMES[playing.sequence[0]!];
    const afterAna = answer(playing, c, ANA, winningValue(game));
    expect(afterAna.phase).toBe('play');
    const afterLeo = answer(afterAna, c, LEO, losingValue(game));
    expect(afterLeo.phase).toBe('reveal');
    expect(c.timers.has('play-end')).toBe(false);
  });

  it('refuse une seconde réponse du même joueur, et toute réponse hors défi', () => {
    const { c, s: start } = started(2);
    const playing = playOf(start, c);
    const game = MICROGAMES[playing.sequence[0]!];
    const once = answer(playing, c, ANA, winningValue(game));
    const again = microDefis.handleAction(once, ANA, 'done', { value: 1 }, c.ctx);
    expect(again.ok).toBe(false);
    const early = microDefis.handleAction(start, ANA, 'done', { value: 1 }, c.ctx);
    expect(early.ok).toBe(false);
  });

  it('un joueur qui ne répond pas rate le défi, et le bilan le montre', () => {
    const { c, s: start } = started(2);
    let s = playOf(start, c);
    const game = MICROGAMES[s.sequence[0]!];
    s = answer(s, c, ANA, winningValue(game));
    s = c.fire(s, 'play-end');
    const board = microDefis.getPublicState(s) as { results: { name: string; success: boolean }[] };
    expect(board.results.find((r) => r.name === 'Ana')?.success).toBe(true);
    expect(board.results.find((r) => r.name === 'Léo')?.success).toBe(false);
  });

  it('additionne les points et classe les joueurs', () => {
    const { c, s: start } = started(1);
    let s = playOf(start, c);
    const game = MICROGAMES[s.sequence[0]!];
    s = answer(s, c, ANA, winningValue(game));
    s = answer(s, c, LEO, losingValue(game));
    const ranking = microDefis.calculateScores(s);
    expect(ranking[0]).toMatchObject({ name: 'Ana', rank: 1 });
    expect(ranking[0]!.points).toBeGreaterThanOrEqual(SUCCESS_POINTS);
    expect(ranking[1]).toMatchObject({ name: 'Léo', points: 0 });
  });

  it('ne laisse pas un joueur rejoindre pendant un défi', () => {
    const { c, s: start } = started(2);
    const s = playOf(start, c);
    const after = microDefis.onPlayerJoin(s, { id: 'zoe', name: 'Zoé' }, c.ctx);
    expect(after.players).not.toHaveProperty('zoe');
  });

  it('ne révèle aucun résultat pendant le défi, ni à l’écran ni au téléphone', () => {
    const { c, s: start } = started(2);
    let s = playOf(start, c);
    const game = MICROGAMES[s.sequence[0]!];
    s = answer(s, c, ANA, winningValue(game));
    expect(microDefis.getPublicState(s)).toMatchObject({ results: null, submitted: ['ana'] });
    expect(microDefis.getPlayerState(s, 'ana')).toMatchObject({ submitted: true, mine: null });
    expect(microDefis.getPlayerState(s, 'leo')).toMatchObject({ submitted: false });
    expect(JSON.stringify(microDefis.getPublicState(s))).not.toMatch(/"success"/);
  });

  it('les robots jouent un défi une seule fois', () => {
    const { c, s: start } = started(2);
    const s = playOf(start, c);
    const suggestion = microDefis.suggest?.(s, 'ana', () => 0.1);
    expect(suggestion?.type).toBe('done');
    const res = microDefis.handleAction(s, ANA, 'done', suggestion?.payload, c.ctx);
    if (!res.ok) throw new Error(res.error);
    expect(microDefis.suggest?.(res.state, 'ana', () => 0.1)).toBeNull();
  });
});
