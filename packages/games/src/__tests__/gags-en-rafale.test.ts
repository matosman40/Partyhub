import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { gagsEnRafale, type GagsState } from '../gags-en-rafale/module.js';
import {
  BALLOON_MAX_MS,
  BALLOON_MIN_MS,
  buildSequence,
  flyAt,
  GAG_IDS,
  GAGS,
  isFlyHit,
  judge,
  LATENCY_SLACK_MS,
  losingAnswer,
  silentOutcome,
  STATUE_MS,
  SUCCESS_POINTS,
  winningAnswer,
} from '../gags-en-rafale/gags.js';

/** Contexte de test : horloge et minuteurs pilotés à la main, tirage déterministe. */
function clock(connected: string[]) {
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
    /** Fait échéance à un minuteur, comme la salle le ferait à l'heure dite. */
    fire(state: GagsState, key: string): GagsState {
      now = Math.max(now, timers.get(key) ?? now);
      timers.delete(key);
      return gagsEnRafale.onTimer(state, key, ctx);
    },
  };
}

const ANA: PlayerRef = { id: 'ana', name: 'Ana' };
const LEO: PlayerRef = { id: 'leo', name: 'Léo' };

function started(rounds = 3, players: PlayerRef[] = [ANA, LEO]) {
  const c = clock(players.map((p) => p.id));
  const init = gagsEnRafale.initialize({ rounds }, players, c.ctx);
  const r = gagsEnRafale.start(init, c.ctx);
  if (!r.ok) throw new Error(r.error);
  return { c, s: r.state };
}

function playOf(s: GagsState, c: ReturnType<typeof clock>): GagsState {
  return c.fire(s, 'intro-end');
}

function currentGag(s: GagsState) {
  return GAGS[s.plan[s.round]!.gag];
}

describe('Gags en rafale : règles des gags', () => {
  it('réussit la réponse gagnante de chaque gag, et échoue la réponse perdante', () => {
    for (const id of GAG_IDS) {
      const gag = GAGS[id];
      const seed = 12345;
      const win = winningAnswer(gag, seed);
      if (win) expect(judge(gag, win, gag.durationMs, seed).success).toBe(true);
      expect(judge(gag, losingAnswer(gag), gag.durationMs, seed).success).toBe(false);
    }
  });

  it('crêpe : un glissement trop rapide pour être humain, ou impossible dans le temps écoulé, ne compte pas', () => {
    expect(judge(GAGS.crepe, { value: 100 }, 2000, 1).success).toBe(false);
    expect(judge(GAGS.crepe, { value: 1500 }, 1000, 1).success).toBe(false);
    expect(judge(GAGS.crepe, { value: 1500 }, 1500 + LATENCY_SLACK_MS, 1).success).toBe(true);
  });

  it('mouche : seul un tap sur la mouche, à l’instant du tap, écrase la mouche', () => {
    const seed = 777;
    const t = 2000;
    const fly = flyAt(seed, t);
    expect(judge(GAGS.mouche, { value: t, x: fly.x, y: fly.y }, 3000, seed).success).toBe(true);
    // Un tap à côté ne compte pas, même au bon moment.
    expect(judge(GAGS.mouche, { value: t, x: fly.x + 0.3, y: fly.y }, 3000, seed).success).toBe(false);
    // Le bon endroit mais pas le bon moment : la mouche n'y est plus.
    const later = flyAt(seed, 4200);
    expect(isFlyHit(seed, 4200, fly.x, fly.y)).toBe(Math.hypot(fly.x - later.x, fly.y - later.y) <= 0.11);
    // Sans coordonnées, rien à juger.
    expect(judge(GAGS.mouche, { value: t }, 3000, seed).success).toBe(false);
  });

  it('mouche : la position reste dans l’aire de jeu, pour toutes les graines et tous les instants', () => {
    for (const seed of [1, 42, 999_999]) {
      for (let t = 0; t <= 6000; t += 137) {
        const { x, y } = flyAt(seed, t);
        expect(x).toBeGreaterThanOrEqual(0.1);
        expect(x).toBeLessThanOrEqual(0.9);
        expect(y).toBeGreaterThanOrEqual(0.1);
        expect(y).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('ballon : seul un maintien dans la fenêtre compte', () => {
    expect(judge(GAGS.ballon, { value: BALLOON_MIN_MS - 1 }, 3000, 1).success).toBe(false);
    expect(judge(GAGS.ballon, { value: BALLOON_MIN_MS }, 3000, 1).success).toBe(true);
    expect(judge(GAGS.ballon, { value: BALLOON_MAX_MS }, 3000, 1).success).toBe(true);
    expect(judge(GAGS.ballon, { value: BALLOON_MAX_MS + 1 }, 3000, 1).success).toBe(false);
  });

  it('statue : il faut tenir immobile au moins la durée requise, sans dépasser le temps écoulé', () => {
    expect(judge(GAGS.statue, { value: STATUE_MS - 1 }, 3000, 1).success).toBe(false);
    expect(judge(GAGS.statue, { value: STATUE_MS }, 1000, 1).success).toBe(false);
    expect(judge(GAGS.statue, { value: STATUE_MS }, 2000, 1).success).toBe(true);
  });

  it('gratte : un grattage trop court ne compte pas', () => {
    expect(judge(GAGS.gratte, { value: 200 }, 3000, 1).success).toBe(false);
    expect(judge(GAGS.gratte, { value: 2000 }, 3000, 1).success).toBe(true);
  });

  it('patience : toucher perd, ne rien faire gagne', () => {
    expect(judge(GAGS.patience, { value: 3000 }, 4000, 1).success).toBe(false);
    expect(silentOutcome(GAGS.patience)).toMatchObject({ success: true, points: SUCCESS_POINTS });
    expect(silentOutcome(GAGS.crepe)).toEqual({ success: false, points: 0 });
  });

  it('donne plus de points quand on réussit vite', () => {
    const vite = judge(GAGS.statue, { value: STATUE_MS }, STATUE_MS, 1);
    const lent = judge(GAGS.statue, { value: STATUE_MS }, GAGS.statue.durationMs, 1);
    expect(vite.points).toBeGreaterThan(lent.points);
    expect(lent.points).toBeGreaterThanOrEqual(SUCCESS_POINTS);
    expect(vite.points).toBeLessThanOrEqual(SUCCESS_POINTS + 60);
  });
});

describe('Gags en rafale : suite des gags', () => {
  it('ne répète jamais le même gag de suite, et utilise tous les gags sur une longue partie', () => {
    let state = 7;
    const random = () => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    const seq = buildSequence(30, random);
    expect(seq).toHaveLength(30);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq).size).toBe(GAG_IDS.length);
  });

  it('donne la même suite à partir du même tirage', () => {
    expect(buildSequence(8, () => 0.3)).toEqual(buildSequence(8, () => 0.3));
  });

  it('les robots réussissent avec leur réponse gagnante, dès que leur action arrive (0,7 s au plus tôt)', () => {
    // Un robot agit au plus tôt 0,7 s après le début du gag : sa réponse doit rester possible à ce moment-là.
    // La statue fait exception : elle demande 1,5 s de immobilité, donc le robot ne gagne qu'après ce délai.
    for (const id of GAG_IDS) {
      if (id === 'statue') continue;
      const win = winningAnswer(GAGS[id], 5);
      if (!win) continue;
      expect(judge(GAGS[id], win, 700, 5).success).toBe(true);
    }
    expect(judge(GAGS.statue, winningAnswer(GAGS.statue, 5)!, STATUE_MS + LATENCY_SLACK_MS, 5).success).toBe(true);
  });
});

describe('Gags en rafale : déroulement d’une partie', () => {
  /** Une réponse envoyée après `afterMs` de gag (le temps passe, comme sur un vrai téléphone). */
  function answer(
    s: GagsState,
    c: ReturnType<typeof clock>,
    player: PlayerRef,
    payload: { value: number; x?: number; y?: number },
    afterMs = 1000,
  ): GagsState {
    c.advance(afterMs);
    const res = gagsEnRafale.handleAction(s, player, 'done', payload, c.ctx);
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('fonctionne seul : présentation, gag, bilan, puis fin après le dernier gag', () => {
    const { c, s: start } = started(2, [ANA]);
    expect(start.phase).toBe('intro');
    expect(gagsEnRafale.getPublicState(start)).toMatchObject({ phase: 'intro', round: 1, rounds: 2 });

    let s = playOf(start, c);
    expect(s.phase).toBe('play');
    const gag = currentGag(s);
    expect(gagsEnRafale.getPublicState(s)).toMatchObject({ microgame: { id: gag.id, durationMs: gag.durationMs } });

    // Solo : une seule réponse suffit à clore le gag.
    s = answer(s, c, ANA, winningAnswer(gag, s.plan[0]!.seed) ?? { value: 0 });
    expect(s.phase).toBe('reveal');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('intro');
    expect(s.round).toBe(1);

    s = playOf(s, c);
    s = c.fire(s, 'play-end');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('final');
    expect(gagsEnRafale.isFinished(s)).toBe(true);
    expect(c.timers.size).toBe(0);
  });

  it('affiche le bilan dès que tous les joueurs connectés ont répondu', () => {
    const { c, s: start } = started(2);
    const playing = playOf(start, c);
    const gag = currentGag(playing);
    const win = winningAnswer(gag, playing.plan[0]!.seed) ?? { value: 0 };
    const afterAna = answer(playing, c, ANA, win);
    expect(afterAna.phase).toBe('play');
    const afterLeo = answer(afterAna, c, LEO, losingAnswer(gag));
    expect(afterLeo.phase).toBe('reveal');
    expect(c.timers.has('play-end')).toBe(false);
  });

  it('refuse une seconde réponse du même joueur, et toute réponse hors gag', () => {
    const { c, s: start } = started(2);
    const playing = playOf(start, c);
    const once = answer(playing, c, ANA, { value: 200 });
    expect(gagsEnRafale.handleAction(once, ANA, 'done', { value: 1 }, c.ctx).ok).toBe(false);
    expect(gagsEnRafale.handleAction(start, ANA, 'done', { value: 1 }, c.ctx).ok).toBe(false);
  });

  it('un joueur qui ne répond pas rate un gag ordinaire, et le bilan le montre', () => {
    const { c, s: start } = started(2);
    let s = playOf(start, c);
    const gag = currentGag(s);
    s = answer(s, c, ANA, winningAnswer(gag, s.plan[0]!.seed) ?? { value: 0 });
    s = c.fire(s, 'play-end');
    const board = gagsEnRafale.getPublicState(s) as { results: { name: string; success: boolean }[] };
    expect(board.results.find((r) => r.name === 'Léo')?.success).toBe(false);
  });

  it('un gag d’attente se gagne en ne touchant à rien : le silence réussit à la fin du temps', () => {
    const { c, s: start } = started(1, [ANA, LEO]);
    let s = playOf(start, c);
    // On force le gag d'attente en le plaçant à la première manche.
    s = { ...s, plan: [{ gag: 'patience', seed: 9 }] };
    s = answer(s, c, LEO, { value: 300 }); // Léo touche : il perd.
    s = c.fire(s, 'play-end'); // Ana ne touche rien : elle gagne à la fin.
    const board = gagsEnRafale.getPublicState(s) as { results: { name: string; success: boolean }[] };
    expect(board.results.find((r) => r.name === 'Ana')?.success).toBe(true);
    expect(board.results.find((r) => r.name === 'Léo')?.success).toBe(false);
  });

  it('additionne les points et classe les joueurs', () => {
    const { c, s: start } = started(1);
    let s = playOf(start, c);
    const gag = currentGag(s);
    s = answer(s, c, ANA, winningAnswer(gag, s.plan[0]!.seed) ?? { value: 0 });
    s = answer(s, c, LEO, losingAnswer(gag));
    const ranking = gagsEnRafale.calculateScores(s);
    expect(ranking[0]).toMatchObject({ name: 'Ana', rank: 1 });
    expect(ranking[0]!.points).toBeGreaterThanOrEqual(SUCCESS_POINTS);
    expect(ranking[1]).toMatchObject({ name: 'Léo', points: 0 });
  });

  it('ne laisse pas un joueur rejoindre pendant un gag', () => {
    const { c, s: start } = started(2);
    const s = playOf(start, c);
    const after = gagsEnRafale.onPlayerJoin(s, { id: 'zoe', name: 'Zoé' }, c.ctx);
    expect(after.players).not.toHaveProperty('zoe');
  });

  it('ne révèle aucun résultat pendant le gag, ni à l’écran ni au téléphone', () => {
    const { c, s: start } = started(2);
    let s = playOf(start, c);
    s = answer(s, c, ANA, { value: 200 });
    expect(gagsEnRafale.getPublicState(s)).toMatchObject({ results: null, submitted: ['ana'] });
    expect(gagsEnRafale.getPlayerState(s, 'ana')).toMatchObject({ submitted: true, mine: null });
    expect(gagsEnRafale.getPlayerState(s, 'leo')).toMatchObject({ submitted: false });
    expect(JSON.stringify(gagsEnRafale.getPublicState(s))).not.toMatch(/"success"/);
  });

  it('ne révèle pas la réponse attendue dans la vue publique du gag', () => {
    const { c, s: start } = started(2);
    const s = playOf(start, c);
    const view = JSON.stringify(gagsEnRafale.getPublicState(s));
    // La graine sert à la mouche (position publique), mais aucune réponse n’est écrite en clair.
    expect(view).not.toMatch(/winning|losing|value/);
  });

  it('les robots jouent un gag une seule fois', () => {
    const { c, s: start } = started(2);
    const s = playOf(start, c);
    const suggestion = gagsEnRafale.suggest?.(s, 'ana', () => 0.1);
    expect(suggestion?.type).toBe('done');
    const res = gagsEnRafale.handleAction(s, ANA, 'done', suggestion?.payload, c.ctx);
    if (!res.ok) throw new Error(res.error);
    expect(gagsEnRafale.suggest?.(res.state, 'ana', () => 0.1)).toBeNull();
  });
});

describe('Gags en rafale : réglages', () => {
  it('accepte entre 1 et 20 gags, et 10 par défaut', () => {
    expect(gagsEnRafale.defaultSettings.rounds).toBe(10);
    expect(gagsEnRafale.settingsSchema.safeParse({ rounds: 0 }).success).toBe(false);
    expect(gagsEnRafale.settingsSchema.safeParse({ rounds: 21 }).success).toBe(false);
    expect(gagsEnRafale.settingsSchema.safeParse({ rounds: 20 }).success).toBe(true);
  });

  it('se joue seul ou à plusieurs', () => {
    expect(gagsEnRafale.manifest.minPlayers).toBe(1);
    expect(gagsEnRafale.manifest.maxPlayers).toBeGreaterThanOrEqual(8);
  });
});
