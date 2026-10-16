import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameMenu } from '../components/GameMenu.js';

/**
 * Menu « ⋯ » d'un jeu dans l'administration. Fermé au départ : le bouton annonce son état et
 * désigne le jeu ; aucune action n'est visible tant qu'on ne l'a pas déplié.
 */
describe('Menu d’actions d’un jeu', () => {
  it('est fermé au départ, sans action visible', () => {
    const html = renderToStaticMarkup(
      <GameMenu gameName="Blanc-manger" items={[{ label: 'Dupliquer', onSelect: () => undefined }]} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Autres actions pour Blanc-manger"');
    expect(html).not.toContain('game-menu-panel');
    expect(html).not.toContain('Dupliquer');
  });
});
