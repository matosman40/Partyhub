import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogGame } from '@partyhub/shared';
import { GameRow, playersLabel } from '../components/GameRow.js';

/**
 * Catalogue de l'accueil : une ligne par jeu. Fermée, elle ne montre que le nom et les repères ;
 * ouverte (sous-menu), elle montre la description et les trois actions.
 */

const game = {
  id: 'quiz-party',
  name: 'Quiz Party',
  description: 'Des questions, des bonus de rapidité.',
  category: 'quiz',
  minPlayers: 2,
  maxPlayers: 8,
  durationMin: 15,
  icon: '❓',
} as unknown as CatalogGame;

const handlers = {
  onToggle: () => undefined,
  onCreate: () => undefined,
  onTry: () => undefined,
  onNotice: () => undefined,
};

function row(over: Partial<Parameters<typeof GameRow>[0]> = {}) {
  return renderToStaticMarkup(
    <GameRow game={game} open={false} creating={false} trying={false} busy={false} {...handlers} {...over} />,
  );
}

describe('GameRow', () => {
  it('fermée : nom, repères et état replié, sans les actions', () => {
    const html = row();
    expect(html).toContain('Quiz Party');
    expect(html).toContain('Quiz · 2 à 8 joueurs · environ 15 min');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls');
    expect(html).not.toContain('game-row-panel');
    expect(html).not.toContain('Créer la salle');
    expect(html).not.toContain('Des questions');
  });

  it('ouverte : description, trois actions et lien vers le panneau', () => {
    const html = row({ open: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="game-panel-quiz-party"');
    expect(html).toContain('id="game-panel-quiz-party"');
    expect(html).toContain('Des questions, des bonus de rapidité.');
    expect(html).toContain('Créer la salle');
    expect(html).toContain('Essayer seul');
    expect(html).toContain('Comment jouer');
    expect(html).toContain('is-open');
  });

  it("affiche l'état de création et désactive les actions pendant une opération", () => {
    const html = row({ open: true, creating: true, busy: true });
    expect(html).toContain('Création…');
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it("affiche l'état de préparation de l'essai seul", () => {
    const html = row({ open: true, trying: true, busy: true });
    expect(html).toContain('Préparation…');
  });

  it("n'expose aucune valeur absente", () => {
    expect(row({ open: true })).not.toMatch(/NaN|undefined/);
  });
});

describe('playersLabel', () => {
  it('donne un nombre fixe ou une fourchette', () => {
    expect(playersLabel({ minPlayers: 4, maxPlayers: 4 })).toBe('4');
    expect(playersLabel({ minPlayers: 2, maxPlayers: 8 })).toBe('2 à 8');
  });
});
