import { describe, expect, it } from 'vitest';
import { BALL_R, RACKET_HALF, stepRally, type Rally } from '../tennis/rules.js';

/**
 * Un automate (joueur sans téléphone) peut rater une balle qui arrive devant lui : c’est ce qui fait finir les échanges
 * entre robots. Une raquette commandée par un téléphone ne rate jamais, et sans tirage (`rng` absent) l’échange est
 * déterministe.
 */

/**
 * Balle qui arrive sur le côté haut (1), bien au centre de la raquette. Elle franchit la ligne de frappe en un seul pas
 * (le pas de temps est plafonné à MAX_STEP_S = 0,05 s).
 */
function arrivingAtHaut(rng: (() => number) | undefined, aim: number | null): Rally {
  return {
    ball: { x: 0.5, y: 0.05, vx: 0, vy: -0.5, speed: 0.5 },
    active: [false, true, false, false],
    pos: [0.5, 0.5, 0.5, 0.5],
    aim: [null, aim, null, null],
    bias: [0, 0, 0, 0],
    rng,
  };
}

describe('automate qui rate la balle', () => {
  it('rate la balle quand son tirage tombe sous la chance de rater', () => {
    const events = stepRally(
      arrivingAtHaut(() => 0, null),
      0.05,
    );
    expect(events).toEqual([{ type: 'lost', side: 1 }]);
  });

  it('renvoie la balle quand son tirage est au-dessus de la chance de rater', () => {
    const events = stepRally(
      arrivingAtHaut(() => 0.999, null),
      0.05,
    );
    expect(events).toEqual([{ type: 'hit', side: 1 }]);
  });

  it('ne rate jamais sans tirage : l’échange reste déterministe', () => {
    const events = stepRally(arrivingAtHaut(undefined, null), 0.05);
    expect(events).toEqual([{ type: 'hit', side: 1 }]);
  });

  it('ne rate jamais une raquette commandée par un téléphone', () => {
    // La raquette est au centre et la commande la laisse là : le tirage à zéro ne compte pas.
    const events = stepRally(
      arrivingAtHaut(() => 0, 0),
      0.05,
    );
    expect(events).toEqual([{ type: 'hit', side: 1 }]);
  });

  it('rate une balle hors de la raquette, comme avant', () => {
    const rally = arrivingAtHaut(() => 0.999, null);
    rally.ball.x = 0.5 + RACKET_HALF + BALL_R + 0.05;
    expect(stepRally(rally, 0.05)).toEqual([{ type: 'lost', side: 1 }]);
  });
});
