import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  HoldTimer,
  Pulses,
  ShakeDetector,
  shakeMagnitude,
  SpinTracker,
  Throttle,
  TILT_FULL_DEG,
  tiltFrom,
} from '../client/sensors-core.js';

const NEUTRAL = { beta: 70, gamma: 0 };

describe('Inclinaison', () => {
  it('vaut zéro dans la pose de départ, et suit le sens de l’inclinaison', () => {
    expect(tiltFrom(70, 0, NEUTRAL)).toEqual({ x: 0, y: 0 });
    expect(tiltFrom(70, TILT_FULL_DEG / 2, NEUTRAL).x).toBeCloseTo(0.5);
    expect(tiltFrom(70 - TILT_FULL_DEG / 4, 0, NEUTRAL).y).toBeCloseTo(-0.25);
  });

  it('reste borné à ±1 au-delà de l’échelle', () => {
    expect(tiltFrom(70, 180, NEUTRAL).x).toBe(1);
    expect(tiltFrom(70, -180, NEUTRAL).x).toBe(-1);
    expect(tiltFrom(-200, 0, NEUTRAL).y).toBe(-1);
  });
});

describe('Angles', () => {
  it('prend le plus court chemin, y compris autour de 0 et 360', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(90, 100)).toBe(10);
  });
});

describe('Rotation du téléphone', () => {
  it('compte un tour complet dans un sens', () => {
    const spin = new SpinTracker();
    let total = 0;
    for (let a = 0; a <= 360; a += 15) total = spin.feed(a % 360);
    expect(total).toBeGreaterThanOrEqual(355);
    expect(total).toBeLessThanOrEqual(365);
  });

  it('compte un tour complet dans l’autre sens aussi', () => {
    const spin = new SpinTracker();
    let total = 0;
    for (let a = 360; a >= 0; a -= 15) total = spin.feed(a % 360);
    expect(total).toBeGreaterThanOrEqual(355);
    expect(total).toBeLessThanOrEqual(365);
  });

  it('ne compte pas un va-et-vient comme un tour', () => {
    const spin = new SpinTracker();
    spin.feed(0);
    for (let i = 0; i < 10; i++) {
      spin.feed(90);
      spin.feed(0);
    }
    expect(spin.degrees).toBeLessThan(1);
  });

  it('reprend le progrès perdu quand on revient en arrière', () => {
    const spin = new SpinTracker();
    // Des pas de 100° (le plus court chemin pour un saut de 200° serait dans l’autre sens).
    spin.feed(0);
    spin.feed(100);
    spin.feed(200);
    expect(spin.degrees).toBeCloseTo(200, 0);
    spin.feed(100);
    expect(spin.degrees).toBeCloseTo(100, 0);
  });

  it('ignore les bruits de moins d’un degré', () => {
    const spin = new SpinTracker();
    spin.feed(100);
    for (let i = 0; i < 20; i++) spin.feed(100 + (i % 2) * 0.3);
    expect(spin.degrees).toBe(0);
  });

  it('reprend de zéro après reset', () => {
    const spin = new SpinTracker();
    spin.feed(0);
    spin.feed(90);
    spin.reset();
    expect(spin.degrees).toBe(0);
  });
});

describe('Secousses', () => {
  it('compte un passage du seuil vers le haut, pas chaque mesure au-dessus', () => {
    const shake = new ShakeDetector(12, 160);
    let t = 0;
    for (let i = 0; i < 5; i++) {
      shake.feed(20, t);
      t += 20;
      shake.feed(0, t);
      t += 200;
    }
    expect(shake.pulses.count).toBe(5);
  });

  it('ne compte pas deux secousses trop rapprochées', () => {
    const shake = new ShakeDetector(12, 160);
    shake.feed(20, 0);
    shake.feed(0, 10);
    expect(shake.feed(20, 60)).toBe(false);
    expect(shake.pulses.count).toBe(1);
  });

  it('fait monter l’énergie puis la fait retomber', () => {
    const p = new Pulses(100, 500, 0.5);
    p.hit(0);
    expect(p.energy).toBeCloseTo(0.5);
    p.tick(500);
    expect(p.energy).toBeCloseTo(0.25, 2);
    p.hit(1000);
    expect(p.energy).toBeGreaterThan(0.5);
    expect(p.energy).toBeLessThanOrEqual(1);
  });

  it('calcule l’accélération linéaire, avec repli sur la pesanteur', () => {
    expect(shakeMagnitude({ acceleration: { x: 3, y: 4, z: 0 }, accelerationIncludingGravity: null })).toBe(5);
    expect(shakeMagnitude({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } })).toBeCloseTo(
      0,
    );
    expect(shakeMagnitude({ acceleration: null, accelerationIncludingGravity: null })).toBeNull();
    // Certains navigateurs donnent un objet dont toutes les composantes sont nulles : on passe à la mesure suivante.
    expect(
      shakeMagnitude({
        acceleration: { x: null, y: null, z: null },
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      }),
    ).toBeCloseTo(0, 5);
    expect(
      shakeMagnitude({ acceleration: { x: null, y: null, z: null }, accelerationIncludingGravity: null }),
    ).toBeNull();
  });
});

describe('Maintien dans une zone', () => {
  it('mesure le temps continu, et repart de zéro à la sortie', () => {
    const hold = new HoldTimer();
    expect(hold.feed(true, 1000)).toBe(0);
    expect(hold.feed(true, 2500)).toBe(1500);
    expect(hold.feed(false, 2600)).toBe(0);
    expect(hold.feed(true, 3000)).toBe(0);
    expect(hold.feed(true, 3400)).toBe(400);
  });
});

describe('Débit d’envoi', () => {
  it('laisse passer au plus le débit demandé', () => {
    const throttle = new Throttle(10);
    let sent = 0;
    for (let t = 0; t <= 1000; t += 16) if (throttle.offer(t)) sent++;
    expect(sent).toBeGreaterThanOrEqual(9);
    expect(sent).toBeLessThanOrEqual(11);
  });
});
