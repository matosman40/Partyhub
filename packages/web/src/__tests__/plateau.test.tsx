import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultCharacterFor, defaultLobbyPosition } from '@partyhub/shared';
import { Plateau, type PlateauFigure } from '@partyhub/games/client';

/**
 * Le plateau (salon, plateau de test, futurs jeux) : chaque personnage y figure avec son nom,
 * sa bulle d'émotion et son étiquette ; seul le personnage de l'appareil est déplaçable.
 */

const figures: PlateauFigure[] = [
  {
    id: 'a',
    name: 'Lina',
    position: { x: 0.3, y: 0.6 },
    character: defaultCharacterFor('Lina'),
    mood: 'joy',
    bubble: { emoji: '🎉', key: 'e1' },
    mine: true,
    tags: ['prêt'],
  },
  {
    id: 'b',
    name: 'Théo',
    position: defaultLobbyPosition(1, 2),
    character: defaultCharacterFor('Théo'),
    away: true,
  },
];

describe('Plateau', () => {
  it('affiche chaque personnage avec son nom, sa bulle et son étiquette', () => {
    const html = renderToStaticMarkup(<Plateau figures={figures} label="Test" onMove={() => undefined} />);
    expect(html).toContain('Lina');
    expect(html).toContain('Théo');
    expect(html).toContain('🎉');
    expect(html).toContain('plateau-tag');
    expect(html).toContain('is-away');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('rend son propre personnage déplaçable (tabulation, description du rôle), et seulement celui-là', () => {
    const html = renderToStaticMarkup(<Plateau figures={figures} label="Test" onMove={() => undefined} />);
    expect(html.match(/aria-roledescription="personnage déplaçable"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).not.toContain('role="button"');
    expect(html).toContain('(vous)');
  });

  it('sans déplacement (écran principal), aucun personnage n’est interactif', () => {
    const html = renderToStaticMarkup(<Plateau figures={figures} label="Test" />);
    expect(html).not.toContain('aria-roledescription');
    expect(html).not.toContain('is-own');
  });

  it('affiche le texte vide quand aucun personnage n’est là', () => {
    const html = renderToStaticMarkup(<Plateau figures={[]} label="Test" emptyText="Personne encore" />);
    expect(html).toContain('Personne encore');
    expect(html).toContain('plateau-scene');
  });
});
