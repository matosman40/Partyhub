import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLogo } from '../components/GameLogo.js';
import { GAME_LOGOS, fallbackLogo, logoFor, type LogoMark } from '../components/gameLogos.js';

/** Identité visuelle des jeux : chaque jeu intégré a la sienne, les autres en reçoivent une stable. */

const BUILTIN_IDS = [
  'association',
  'bombes-party',
  'imposteur',
  'loups-village',
  'plus-ou-moins',
  'plutot-qui',
  'president',
  'promoteur',
  'quiz-party',
  'rami-51',
  'reflexe',
  'tarot',
];

const MARKS: LogoMark[] = [
  'bubble',
  'fuse',
  'lens',
  'moon',
  'arrows',
  'crown',
  'skyline',
  'deck',
  'bolt',
  'star',
  'duo',
  'frame',
];

describe('Logos des jeux', () => {
  it('ont une identité dessinée pour chaque jeu intégré', () => {
    for (const id of BUILTIN_IDS) {
      const spec = GAME_LOGOS[id];
      expect(spec, id).toBeDefined();
      expect(spec!.lines[0].length, id).toBeGreaterThan(0);
    }
  });

  it('utilisent des motifs et des couleurs distincts d’un jeu à l’autre', () => {
    const specs = BUILTIN_IDS.map((id) => GAME_LOGOS[id]!);
    expect(new Set(specs.map((s) => s.mark)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(specs.map((s) => s.fill)).size).toBe(specs.length);
    for (const spec of specs) expect(MARKS).toContain(spec.mark);
  });

  it('donnent au repli une identité stable pour un même identifiant', () => {
    expect(fallbackLogo('paquet-xyz', 'Mon jeu')).toEqual(fallbackLogo('paquet-xyz', 'Mon jeu'));
    const spec = fallbackLogo('paquet-xyz', 'Mon super jeu de société');
    expect(spec.lines).toEqual(['Mon', 'super jeu de société']);
    expect(MARKS).toContain(spec.mark);
  });

  it('préfèrent la spécification dessinée au repli', () => {
    expect(logoFor('tarot', 'Tarot')).toBe(GAME_LOGOS.tarot);
  });

  it('rendent un SVG nommé par le titre du jeu, sans valeur invalide', () => {
    for (const id of [...BUILTIN_IDS, 'jeu-inconnu']) {
      const html = renderToStaticMarkup(<GameLogo gameId={id} name="Un nom de jeu" />);
      expect(html).toContain('<svg');
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Un nom de jeu"');
      expect(html).not.toMatch(/NaN|undefined/);
    }
  });
});
