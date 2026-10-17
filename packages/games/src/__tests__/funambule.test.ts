import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { funambule, funambuleSettingsSchema, type FunambuleState } from '../funambule/module.js';
import {
  CROSSING_BONUS,
  FALL_HOLD_MS,
  FallDetector,
  GRACE_MS,
  LATENCY_SLACK_MS,
  TILT_GAIN,
  WALK_MS,
  WALK_POINTS,
  clampUnit,
  judgeWalk,
  leanOf,
  windAt,
  windLabel,
  windPeak,
  windStrength,
} from '../funambule/rules.js';

/** Contexte de test : horloge et minuteurs pilotés à la main. */
function clock(players: string[], connected = players) {
  let now = 1_000_000;
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, now + ms),
    cancel: (key) => void timers.delete(key),
    random: (() => {
      let seed = 7;
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
    fire(state: FunambuleState, key: string): FunambuleState {
      now = Math.max(now, timers.get(key) ?? now);
      timers.delete(key);
      return funambule.onTimer(state, key, ctx);
    },
  };
}

const ANA: PlayerRef = { id: 'ana', name: 'Ana' };
const LEO: PlayerRef = { id: 'leo', name: 'Léo' };

function started(rounds = 3) {
  const c = clock(['ana', 'leo']);
  const init = funambule.initialize({ rounds }, [ANA, LEO], c.ctx);
  const r = funambule.start(init, c.ctx);
  if (!r.ok) throw new Error(r.error);
  return { c, s: r.state };
}

const walking = (s: FunambuleState, c: ReturnType<typeof clock>) => c.fire(s, 'intro-end');

describe('Funambule : le vent', () => {
  it('ne dépasse jamais sa crête, quelle que soit la graine ou la manche', () => {
    for (let round = 0; round < 6; round++) {
      const strength = windStrength(round);
      for (const seed of [0, 0.13, 0.5, 0.87, 0.999]) {
        for (let t = 0; t <= WALK_MS; t += 37) {
          expect(Math.abs(windAt(t, strength, seed))).toBeLessThanOrEqual(windPeak(strength) + 1e-9);
        }
      }
    }
  });

  it('est déterministe : le téléphone et l’écran principal calculent la même valeur', () => {
    expect(windAt(4321, 0.9, 0.42)).toBe(windAt(4321, 0.9, 0.42));
    expect(windAt(4321, 0.9, 0.42)).not.toBe(windAt(4321, 0.9, 0.43));
  });

  it('se renforce d’une manche à l’autre, sans dépasser la limite', () => {
    const strengths = [0, 1, 2, 3, 4, 5, 6, 9].map(windStrength);
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i]!).toBeGreaterThanOrEqual(strengths[i - 1]!);
    }
    expect(Math.max(...strengths)).toBeLessThanOrEqual(1.2);
  });

  it('nomme le vent selon sa force', () => {
    expect(windLabel(0.75)).toBe('Vent léger');
    expect(windLabel(0.95)).toBe('Vent soutenu');
    expect(windLabel(1.2)).toBe('Vent violent');
  });
});

describe('Funambule : la chute', () => {
  it('ne tombe pas tant que le personnage reste dans l’équilibre', () => {
    const fd = new FallDetector();
    for (let t = 0; t <= WALK_MS; t += 20) expect(fd.feed(0.9, t)).toBeNull();
    expect(fd.fallen).toBe(false);
  });

  it('pardonne un déséquilibre plus court que le délai de tenue', () => {
    const fd = new FallDetector();
    expect(fd.feed(1.2, 1000)).toBeNull();
    expect(fd.feed(1.2, 1000 + FALL_HOLD_MS - 50)).toBeNull();
    expect(fd.feed(0.2, 1000 + FALL_HOLD_MS)).toBeNull();
    expect(fd.feed(1.2, 3000)).toBeNull();
  });

  it('date la chute du premier instant de déséquilibre, et ne revient pas en arrière', () => {
    const fd = new FallDetector();
    fd.feed(-1.1, 2000);
    expect(fd.feed(-1.1, 2000 + FALL_HOLD_MS)).toBe(2000);
    expect(fd.feed(0, 9000)).toBe(2000);
    expect(fd.fallen).toBe(true);
  });

  it('traduit l’inclinaison du téléphone en position, avec le gain du fil', () => {
    expect(leanOf(1, 0)).toBe(TILT_GAIN);
    expect(leanOf(-0.5, 0.3)).toBeCloseTo(-0.5 * TILT_GAIN + 0.3);
    expect(clampUnit(3)).toBe(1);
    expect(clampUnit(-3)).toBe(-1);
  });
});

describe('Funambule : jugement d’une traversée', () => {
  it('compte la traversée complète, avec la prime', () => {
    const v = judgeWalk(WALK_MS, WALK_MS + 100);
    expect(v).toEqual({ survived: WALK_MS, success: true, points: WALK_POINTS + CROSSING_BONUS });
  });

  it('ne compte que le temps tenu quand le personnage tombe', () => {
    const v = judgeWalk(4000, 4200);
    expect(v.success).toBe(false);
    expect(v.survived).toBe(4000);
    expect(v.points).toBe(Math.round((WALK_POINTS * 4000) / WALK_MS));
  });

  it('refuse un temps supérieur à ce qui s’est écoulé (à la tolérance réseau près)', () => {
    expect(judgeWalk(WALK_MS, 1000).survived).toBe(1000 + LATENCY_SLACK_MS);
    expect(judgeWalk(WALK_MS, 1000).success).toBe(false);
    expect(judgeWalk(WALK_MS, WALK_MS - 200).success).toBe(true);
  });

  it('ne dépasse jamais la durée de la traversée, et ne compte rien à zéro', () => {
    expect(judgeWalk(WALK_MS * 3, 99_999).survived).toBe(WALK_MS);
    expect(judgeWalk(0, 5000)).toEqual({ survived: 0, success: false, points: 0 });
  });
});

/**
 * Trois joueurs simulés, pour caler la difficulté : un joueur parfait, un joueur immobile, et un joueur qui
 * réagit avec 300 ms de retard (un temps de réaction humain). Les graines couvrent tout l'intervalle.
 */
describe('Funambule : difficulté simulée', () => {
  const seeds = [0.05, 0.1, 0.25, 0.37, 0.5, 0.62, 0.75, 0.9];

  function walk(tiltAt: (t: number, round: number, seed: number) => number, round: number, seed: number): number {
    const strength = windStrength(round);
    const fd = new FallDetector();
    for (let t = 0; t < WALK_MS; t += 16) {
      const wind = windAt(t, strength, seed);
      const tilt = clampUnit(tiltAt(t, round, seed));
      const fellAt = fd.feed(leanOf(tilt, wind), t);
      if (fellAt !== null) return fellAt;
    }
    return WALK_MS;
  }

  /** Inclinaison qui annule le vent de l’instant `t - lagMs`. */
  const counter =
    (lagMs: number) =>
    (t: number, round: number, seed: number): number =>
      -windAt(Math.max(0, t - lagMs), windStrength(round), seed) / TILT_GAIN;

  it('un joueur qui suit le vent traverse toutes les manches', () => {
    for (let round = 0; round < 6; round++) {
      for (const seed of seeds) expect(walk(counter(0), round, seed)).toBe(WALK_MS);
    }
  });

  it('un joueur qui réagit avec 300 ms de retard traverse toutes les manches', () => {
    for (let round = 0; round < 6; round++) {
      for (const seed of seeds) expect(walk(counter(300), round, seed)).toBe(WALK_MS);
    }
  });

  it('un joueur immobile tient les trois premières manches, puis tombe', () => {
    for (let round = 0; round < 3; round++) {
      for (const seed of seeds) expect(walk(() => 0, round, seed)).toBe(WALK_MS);
    }
    for (let round = 3; round < 6; round++) {
      const falls = seeds.filter((seed) => walk(() => 0, round, seed) < WALK_MS).length;
      expect(falls).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('Funambule : déroulement d’une partie', () => {
  /** Une réponse envoyée après `afterMs` de traversée, comme sur un vrai téléphone. */
  function answer(
    s: FunambuleState,
    c: ReturnType<typeof clock>,
    player: PlayerRef,
    value: number,
    afterMs = WALK_MS,
  ): FunambuleState {
    c.advance(afterMs);
    const res = funambule.handleAction(s, player, 'done', { value }, c.ctx);
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('n’accepte que 1 à 6 manches, trois par défaut', () => {
    expect(funambuleSettingsSchema.parse({}).rounds).toBe(3);
    expect(() => funambuleSettingsSchema.parse({ rounds: 7 })).toThrow();
    expect(() => funambuleSettingsSchema.parse({ rounds: 0 })).toThrow();
  });

  it('présente le vent de chaque manche, puis lance la traversée', () => {
    const { c, s: start } = started(2);
    expect(start.phase).toBe('intro');
    expect(start.seeds).toHaveLength(2);
    expect(funambule.getPublicState(start)).toMatchObject({
      phase: 'intro',
      round: 1,
      rounds: 2,
      wind: { seed: start.seeds[0], strength: windStrength(0), label: windLabel(windStrength(0)), walkMs: WALK_MS },
    });
    const s = walking(start, c);
    expect(s.phase).toBe('walk');
    expect(s.endsAt - s.startedAt).toBe(WALK_MS + GRACE_MS);
    expect(c.timers.has('walk-end')).toBe(true);
  });

  it('ne révèle ni le temps tenu ni les points pendant la traversée', () => {
    const { c, s: start } = started(2);
    let s = walking(start, c);
    s = answer(s, c, ANA, WALK_MS, 0);
    expect(s.phase).toBe('walk');
    s = answer(s, c, LEO, 3000, 0);
    expect(s.phase).toBe('reveal');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('intro');

    const { c: c2, s: s2 } = started(2);
    let walkS = walking(s2, c2);
    walkS = answer(walkS, c2, ANA, 4000, 4100);
    const view = JSON.stringify(funambule.getPublicState(walkS));
    // Le classement (points totaux) est public ; le temps tenu et la réussite ne le sont qu’au bilan.
    expect(view).not.toMatch(/"survived"|"success"/);
    expect(funambule.getPublicState(walkS)).toMatchObject({ fallen: ['ana'], crossed: [] });
  });

  it('une traversée complète rapporte la prime, une chute seulement le temps tenu', () => {
    const { c, s: start } = started(2);
    let s = walking(start, c);
    s = answer(s, c, ANA, WALK_MS);
    s = answer(s, c, LEO, 3000, 0);
    expect(s.phase).toBe('reveal');
    const board = funambule.getPublicState(s) as { results: { name: string; success: boolean; survived: number }[] };
    expect(board.results.find((r) => r.name === 'Ana')).toMatchObject({ success: true, survived: WALK_MS });
    expect(board.results.find((r) => r.name === 'Léo')).toMatchObject({ success: false, survived: 3000 });
    expect(s.points.ana).toBe(WALK_POINTS + CROSSING_BONUS);
    expect(s.points.leo).toBe(Math.round((WALK_POINTS * 3000) / WALK_MS));
  });

  it('refuse les réponses hors traversée, les doublons et les actions inconnues', () => {
    const { c, s: start } = started(2);
    expect(funambule.handleAction(start, ANA, 'done', { value: 1 }, c.ctx).ok).toBe(false);
    const walkS = walking(start, c);
    expect(funambule.handleAction(walkS, ANA, 'autre', { value: 1 }, c.ctx).ok).toBe(false);
    const once = answer(walkS, c, ANA, 5000, 0);
    expect(funambule.handleAction(once, ANA, 'done', { value: 1 }, c.ctx).ok).toBe(false);
    expect(funambule.handleAction(once, { id: 'zoe', name: 'Zoé' }, 'done', { value: 1 }, c.ctx).ok).toBe(false);
  });

  it('passe au bilan dès que tout le monde a fini, sans attendre la fin du temps', () => {
    const { c, s: start } = started(2);
    const walkS = walking(start, c);
    const afterAna = answer(walkS, c, ANA, 5000, 0);
    expect(afterAna.phase).toBe('walk');
    const afterLeo = answer(afterAna, c, LEO, 2000, 0);
    expect(afterLeo.phase).toBe('reveal');
    expect(c.timers.has('walk-end')).toBe(false);
  });

  it('au bout du temps, un joueur muet tombe à zéro et le bilan s’affiche', () => {
    const { c, s: start } = started(2);
    let s = walking(start, c);
    s = answer(s, c, ANA, WALK_MS, 0);
    s = c.fire(s, 'walk-end');
    expect(s.phase).toBe('reveal');
    const board = funambule.getPublicState(s) as { results: { name: string; survived: number }[] };
    expect(board.results.find((r) => r.name === 'Léo')?.survived).toBe(0);
  });

  it('enchaîne les manches, puis termine après la dernière', () => {
    const { c, s: start } = started(2);
    let s = walking(start, c);
    s = c.fire(s, 'walk-end');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('intro');
    expect(s.round).toBe(1);
    s = walking(s, c);
    s = c.fire(s, 'walk-end');
    s = c.fire(s, 'reveal-end');
    expect(s.phase).toBe('final');
    expect(funambule.isFinished(s)).toBe(true);
    expect(c.timers.size).toBe(0);
  });

  it('classe les joueurs par points, et gère le départ d’un joueur', () => {
    const { c, s: start } = started(2);
    let s = walking(start, c);
    // Léo traverse après douze secondes ; Ana tombe une seconde plus tard, à 13 secondes.
    s = answer(s, c, LEO, WALK_MS, WALK_MS);
    s = answer(s, c, ANA, 1000, 1000);
    expect(s.phase).toBe('reveal');
    const ranking = funambule.calculateScores(s);
    expect(ranking[0]).toMatchObject({ playerId: 'leo' });
    // Avant le lancement, un joueur qui part quitte la partie ; pendant la traversée, il reste inscrit.
    const init = funambule.initialize({ rounds: 2 }, [ANA, LEO], c.ctx);
    expect(Object.keys(funambule.onPlayerLeave(init, LEO).players)).toEqual(['ana']);
    expect(Object.keys(funambule.onPlayerLeave(start, LEO).players)).toEqual(['ana', 'leo']);
  });

  it('les robots du mode test traversent ou tombent, une seule fois par manche', () => {
    const { c, s: start } = started(2);
    const s = walking(start, c);
    const suggestion = funambule.suggest?.(s, 'ana', () => 0.1);
    expect(suggestion?.type).toBe('done');
    expect(suggestion?.payload).toEqual({ value: WALK_MS });
    const res = funambule.handleAction(s, ANA, 'done', suggestion?.payload, c.ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(funambule.suggest?.(res.state, 'ana', () => 0.1)).toBeNull();
    const falling = funambule.suggest?.(s, 'leo', () => 0.9);
    expect((falling?.payload as { value: number }).value).toBeLessThan(WALK_MS);
  });
});
