import { describe, expect, it } from 'vitest';
import { LATENCY_SLACK_MS, MICROGAMES, MICROGAME_IDS, judge } from '../micro-defis/microgames.js';
import { atScale, flickSpeed, pinchGap, pinchScale, swipeDirection } from '../micro-defis/client/gestures.js';
import { meanLuma } from '../micro-defis/client/camera-luma.js';
import { ClapDetector } from '../client/sensors-core.js';

describe('Défis tactiles et capteurs : règles', () => {
  it('glisse-moi : six glissés justes, pas plus vite que toutes les 250 ms', () => {
    expect(judge(MICROGAMES.glisse, 6, 1500).success).toBe(true);
    expect(judge(MICROGAMES.glisse, 6, 500).success).toBe(false);
    expect(judge(MICROGAMES.glisse, 5, 6000).success).toBe(false);
    expect(judge(MICROGAMES.glisse, 40, 1000).success).toBe(false);
  });

  it('répète le motif : quatre symboles, saisis pas plus vite que toutes les 300 ms', () => {
    expect(judge(MICROGAMES.vibre, 4, 1000).success).toBe(true);
    expect(judge(MICROGAMES.vibre, 4, 500).success).toBe(false);
    expect(judge(MICROGAMES.vibre, 3, 8000).success).toBe(false);
  });

  it('cache la lumière : deux secondes d’objectif couvert, comme pour l’équilibre', () => {
    expect(judge(MICROGAMES.lumiere, 2000, 1000).success).toBe(false);
    expect(judge(MICROGAMES.lumiere, 2000, 2000 - LATENCY_SLACK_MS).success).toBe(true);
    expect(judge(MICROGAMES.lumiere, 1999, 8000).success).toBe(false);
  });

  it('applaudissez : cinq claquements, pas plus vite que toutes les 180 ms', () => {
    expect(judge(MICROGAMES.applaudis, 5, 1000).success).toBe(true);
    expect(judge(MICROGAMES.applaudis, 5, 300).success).toBe(false);
    expect(judge(MICROGAMES.applaudis, 4, 5000).success).toBe(false);
  });

  it('pince la taille : tenir la bonne taille une seconde et demie', () => {
    expect(judge(MICROGAMES.pince, 1500, 1000).success).toBe(false);
    expect(judge(MICROGAMES.pince, 1500, 1200).success).toBe(true);
  });

  it('lance le ballon : un lancer dans la fenêtre, ni trop faible ni le double', () => {
    expect(judge(MICROGAMES.lance, 200, 0).success).toBe(true);
    expect(judge(MICROGAMES.lance, 400, 0).success).toBe(true);
    expect(judge(MICROGAMES.lance, 199, 0).success).toBe(false);
    expect(judge(MICROGAMES.lance, 401, 0).success).toBe(false);
    expect(judge(MICROGAMES.lance, 0, 0).success).toBe(false);
  });

  it('chaque défi a une consigne, une précision, une durée et un capteur', () => {
    for (const id of MICROGAME_IDS) {
      const game = MICROGAMES[id];
      expect(game.instruction.length).toBeGreaterThan(10);
      expect(game.hint.length).toBeGreaterThan(10);
      expect(game.durationMs).toBeGreaterThan(0);
      // « Pile » n’a pas de cible : sa valeur est l’instant de l’appui.
      expect(game.target).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(MICROGAME_IDS.map((id) => MICROGAMES[id].sensor)).size).toBeGreaterThanOrEqual(10);
  });
});

describe('Gestes tactiles', () => {
  it('reconnaît la direction dominante d’un glissé, et ignore les petits mouvements', () => {
    expect(swipeDirection(60, 5)).toBe('right');
    expect(swipeDirection(-60, 0)).toBe('left');
    expect(swipeDirection(0, -50)).toBe('up');
    expect(swipeDirection(0, 50)).toBe('down');
    expect(swipeDirection(10, 10)).toBeNull();
  });

  it('mesure l’écart des doigts et la taille du pincement', () => {
    expect(pinchGap({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchScale(140, 140)).toBe(1);
    expect(pinchScale(140, 0)).toBe(0);
    expect(atScale(1.05, 1)).toBe(true);
    expect(atScale(1.1, 1)).toBe(false);
  });

  it('mesure la vitesse d’un lancer vers le haut, en hauteurs d’écran par seconde', () => {
    const up = [
      { x: 0, y: 500, t: 0 },
      { x: 0, y: 400, t: 50 },
    ];
    expect(flickSpeed(up, 1000)).toBeCloseTo(2, 5);
    const down = [
      { x: 0, y: 400, t: 0 },
      { x: 0, y: 500, t: 50 },
    ];
    expect(flickSpeed(down, 1000)).toBeLessThan(0);
  });

  it('ne compte que les derniers 120 ms avant le relâchement', () => {
    const trail = [
      { x: 0, y: 900, t: 0 },
      { x: 0, y: 880, t: 300 },
      { x: 0, y: 700, t: 400 },
    ];
    // Les 120 dernières millisecondes : de 880 à 700 en 100 ms, soit 180 px sur 1000 px.
    expect(flickSpeed(trail, 1000)).toBeCloseTo((180 / 1000) * (1000 / 100), 5);
    expect(flickSpeed([{ x: 0, y: 0, t: 0 }], 1000)).toBe(0);
  });
});

describe('Claquements et lumière de la caméra', () => {
  it('compte un claquement à chaque montée franche, après être retombé', () => {
    const d = new ClapDetector();
    expect(d.feed(0.1, 0)).toBe(false);
    expect(d.feed(0.7, 50)).toBe(true);
    // Toujours haut : ce n’est pas un nouveau claquement.
    expect(d.feed(0.8, 100)).toBe(false);
    expect(d.feed(0.1, 200)).toBe(false);
    expect(d.feed(0.9, 400)).toBe(true);
    expect(d.pulses.count).toBe(2);
  });

  it('refuse deux claquements trop rapprochés', () => {
    const d = new ClapDetector();
    expect(d.feed(0.1, 0)).toBe(false);
    expect(d.feed(0.6, 10)).toBe(true);
    expect(d.feed(0.1, 20)).toBe(false);
    expect(d.feed(0.6, 60)).toBe(false);
    expect(d.pulses.count).toBe(1);
  });

  it('calcule la luminosité moyenne d’une image, sans garder l’image', () => {
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(127.5, 5);
    expect(meanLuma(new Uint8ClampedArray([]))).toBe(0);
  });
});
