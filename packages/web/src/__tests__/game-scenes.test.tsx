import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameScene } from '../components/GameScene.js';

/** Décors de jeu : un SVG valide par jeu, déterministe, distinct d'un jeu intégré à l'autre. */

const BUILTIN_IDS = [
  'association',
  'aventure-ia',
  'bombes-party',
  'funambule',
  'gags-en-rafale',
  'imposteur',
  'loups-village',
  'micro-defis',
  'phrases-trous',
  'plus-ou-moins',
  'plutot-qui',
  'poker-texas',
  'president',
  'promoteur',
  'quiz-party',
  'rami-51',
  'reflexe',
  'tarot',
];

const render = (id: string, name = 'Un jeu') => renderToStaticMarkup(<GameScene gameId={id} name={name} />);

describe('Décors des jeux', () => {
  it('rendent un SVG décoratif, rogné à toutes les proportions', () => {
    for (const id of [...BUILTIN_IDS, 'jeu-inconnu']) {
      const html = render(id);
      expect(html, id).toContain('<svg');
      expect(html, id).toContain('viewBox="0 0 1600 900"');
      expect(html, id).toContain('preserveAspectRatio="xMidYMid slice"');
      expect(html, id).toContain('aria-hidden="true"');
      expect(html, id).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it('sont déterministes : même jeu, même décor', () => {
    for (const id of BUILTIN_IDS) expect(render(id)).toBe(render(id));
    expect(render('paquet-xyz', 'Mon jeu')).toBe(render('paquet-xyz', 'Mon jeu'));
  });

  it('donnent un décor propre à chaque jeu intégré', () => {
    const scenes = new Set(BUILTIN_IDS.map((id) => render(id)));
    expect(scenes.size).toBe(BUILTIN_IDS.length);
  });

  it('identifient le dégradé par jeu, pour que plusieurs décors coexistent dans la page', () => {
    const html = render('tarot');
    expect(html).toContain('id="sky-tarot"');
    expect(html).toContain('url(#sky-tarot)');
  });
});
