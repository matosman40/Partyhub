import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { GameListRow } from '../components/GameListRow.js';
import { GameSheet } from '../components/GameSheet.js';
import { playersLabel } from '../catalog/display.js';

/** Ligne de liste (lien vers la fiche), captures de la fiche. Rendu statique. */

const quiz = {
  id: 'quiz-party',
  name: 'Quiz Party',
  description: 'Des questions, des bonus de rapidité.',
  category: 'quiz',
  minPlayers: 2,
  maxPlayers: 8,
  durationMin: 15,
  version: '1.4.0',
  ai: true,
  notice: { goal: 'Répondre juste.', steps: ['Répondre.'], tips: [] },
} as unknown as CatalogGame;

function row(game: CatalogGame = quiz) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ul>
        <GameListRow game={game} />
      </ul>
    </MemoryRouter>,
  );
}

function sheet(photos: string[] | undefined) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <GameSheet
        game={quiz}
        recent={false}
        sameCategory={[]}
        photos={photos}
        creating={false}
        trying={false}
        error={null}
        onCreate={() => undefined}
        onCreateNoScreen={() => undefined}
        onTry={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('GameListRow', () => {
  it('est un lien vers la fiche, sans bouton de lancement', () => {
    const html = row();
    expect(html).toContain('href="/jeux/quiz-party"');
    expect(html).toContain('Quiz Party');
    expect(html).toContain('Quiz · 2 à 8 joueurs · environ 15 min');
    expect(html).not.toContain('Créer la salle');
    expect(html).not.toContain('<button');
  });

  it('n’affiche aucune valeur absente', () => {
    expect(row()).not.toMatch(/NaN|undefined/);
  });
});

describe('playersLabel', () => {
  it('donne un nombre fixe ou une fourchette', () => {
    expect(playersLabel({ minPlayers: 4, maxPlayers: 4 })).toBe('4');
    expect(playersLabel({ minPlayers: 2, maxPlayers: 8 })).toBe('2 à 8');
  });
});

describe('captures de la fiche', () => {
  it('sans capture, n’affiche pas la galerie', () => {
    expect(sheet(undefined)).not.toContain('sheet-gallery');
    expect(sheet([])).not.toContain('sheet-gallery');
  });

  it('avec une capture, l’affiche en grand sans vignettes', () => {
    const html = sheet(['/game-photos/quiz-party/lobby.jpg']);
    expect(html).toContain('sheet-gallery');
    expect(html).toContain('src="/game-photos/quiz-party/lobby.jpg"');
    expect(html).toContain('alt="Capture de Quiz Party, 1 sur 1"');
    expect(html).not.toContain('sheet-thumbs');
  });

  it('avec plusieurs captures, propose des vignettes et marque la première', () => {
    const html = sheet(['/game-photos/quiz-party/lobby.jpg', '/game-photos/quiz-party/partie.jpg']);
    expect(html).toContain('sheet-thumbs');
    expect(html).toContain('aria-label="Capture 1"');
    expect(html).toContain('aria-label="Capture 2"');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html).toContain('Prises sur des parties d’essai avec des robots.');
    expect(html).not.toContain('Prises à la première partie');
  });

  it('dit d’où viennent les captures : première partie réelle ou partie d’essai', () => {
    const real = sheet(['/api/game-photos/quiz-party/1.jpg']);
    expect(real).toContain('Prises à la première partie de ce jeu, sur l’écran de la salle.');
    expect(real).not.toContain('robots');
  });
});
