import { describe, expect, it } from 'vitest';
import { extendTrail, type ProgressPoint } from '../solo/engine.js';
import {
  avatarOf,
  axisScale,
  formatClock,
  formatElapsed,
  medalOf,
  seriesColor,
  timeAtPercent,
  valueAt,
} from '../solo/client/progress.js';

describe('courbe d’avancement', () => {
  it('garde un point par palier de 10 %, sans recul, et note toujours la résolution', () => {
    let trail: ProgressPoint[] = [{ ms: 0, percent: 0 }];
    trail = extendTrail(trail, 1_000, 4); // encore dans la tranche 0–9 : pas de point
    trail = extendTrail(trail, 2_000, 7); // même tranche : pas de point
    trail = extendTrail(trail, 3_000, 12); // tranche 10–19
    trail = extendTrail(trail, 4_000, 11); // recul : ignoré
    trail = extendTrail(trail, 5_000, 35); // saut de plusieurs tranches : un seul point
    trail = extendTrail(trail, 9_000, 100); // résolution : toujours notée
    expect(trail).toEqual([
      { ms: 0, percent: 0 },
      { ms: 3_000, percent: 12 },
      { ms: 5_000, percent: 35 },
      { ms: 9_000, percent: 100 },
    ]);
  });

  it('une courbe vide démarre au premier point', () => {
    expect(extendTrail([], 500, 20)).toEqual([{ ms: 500, percent: 20 }]);
  });

  it('la valeur à un instant est le dernier palier atteint avant cet instant', () => {
    const trail: ProgressPoint[] = [
      { ms: 0, percent: 0 },
      { ms: 2_000, percent: 30 },
      { ms: 6_000, percent: 60 },
    ];
    expect(valueAt(trail, 0)).toBe(0);
    expect(valueAt(trail, 1_999)).toBe(0);
    expect(valueAt(trail, 2_000)).toBe(30);
    expect(valueAt(trail, 5_000)).toBe(30);
    expect(valueAt(trail, 60_000)).toBe(60);
    expect(valueAt([], 1_000)).toBe(0);
  });

  it('le temps d’un seuil est le premier instant où la courbe l’atteint', () => {
    const trail: ProgressPoint[] = [
      { ms: 0, percent: 0 },
      { ms: 2_000, percent: 30 },
      { ms: 6_000, percent: 60 },
      { ms: 9_000, percent: 100 },
    ];
    expect(timeAtPercent(trail, 25)).toBe(2_000);
    expect(timeAtPercent(trail, 50)).toBe(6_000);
    expect(timeAtPercent(trail, 75)).toBe(9_000);
    expect(timeAtPercent([{ ms: 0, percent: 0 }], 25)).toBeNull();
  });
});

describe('échelle de temps', () => {
  it('ne descend jamais sous une minute et reste sur une graduation', () => {
    expect(axisScale(5_000).maxMs).toBe(60_000);
    const { maxMs, stepMs } = axisScale(61_000);
    expect(maxMs % stepMs).toBe(0);
    expect(maxMs).toBeGreaterThanOrEqual(61_000);
  });

  it('garde six graduations au plus', () => {
    for (const raw of [45_000, 90_000, 400_000, 900_000, 1_800_000, 3_000_000]) {
      const { maxMs, stepMs } = axisScale(raw);
      expect(maxMs).toBeGreaterThanOrEqual(raw);
      expect(maxMs / stepMs).toBeLessThanOrEqual(6);
    }
  });
});

describe('formats de temps et teintes', () => {
  it('affiche les temps en mm:ss, et la résolution au millième', () => {
    expect(formatClock(125_310)).toBe('02:05');
    expect(formatClock(0)).toBe('00:00');
    expect(formatElapsed(125_310)).toBe('02:05.310');
    expect(formatElapsed(-5)).toBe('00:00.000');
  });

  it('attribue les teintes par place dans la salle, cycliques sur huit', () => {
    expect(seriesColor(0)).toBe('var(--solo-s1)');
    expect(seriesColor(7)).toBe('var(--solo-s8)');
    expect(seriesColor(8)).toBe('var(--solo-s1)');
    expect(seriesColor(-1)).toBe('var(--solo-s1)');
  });

  it('attribue un personnage par place, distinct pour huit joueurs, cyclique ensuite', () => {
    const eight = Array.from({ length: 8 }, (_, i) => avatarOf(i));
    expect(new Set(eight).size).toBe(8);
    expect(avatarOf(8)).toBe(avatarOf(0));
    expect(avatarOf(-1)).toBe(avatarOf(0));
  });

  it('médaille les trois premières places du classement final, rien au-delà', () => {
    expect([medalOf(1), medalOf(2), medalOf(3)]).toEqual(['🥇', '🥈', '🥉']);
    expect(medalOf(4)).toBeNull();
  });
});
