import { describe, expect, it } from 'vitest';
import { gameRegistry } from '@partyhub/games';
import { GAME_LOGOS } from '../components/gameLogos.js';
import { hasDrawnScene } from '../components/GameScene.js';

/**
 * Identité visuelle de chaque jeu du catalogue : un logo et un décor dessinés pour lui, jamais
 * l'identité de repli (qui reprend des formes au hasard). La liste vient du registre : un jeu
 * ajouté sans identité fait échouer ce test.
 */

const listed = gameRegistry.filter((g) => g.manifest.listed !== false).map((g) => g.manifest.id);

describe('Identité visuelle des jeux du catalogue', () => {
  it('chaque jeu listé a un logo dessiné', () => {
    expect(listed.filter((id) => !GAME_LOGOS[id])).toEqual([]);
  });

  it('chaque jeu listé a un décor dessiné', () => {
    expect(listed.filter((id) => !hasDrawnScene(id))).toEqual([]);
  });

  it('chaque logo dessiné a sa propre couleur de titre', () => {
    const fills = listed.map((id) => GAME_LOGOS[id]?.fill).filter((f): f is string => Boolean(f));
    expect(new Set(fills).size).toBe(fills.length);
  });
});
