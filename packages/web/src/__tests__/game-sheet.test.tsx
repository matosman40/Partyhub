import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { GameSheet, playersText } from '../components/GameSheet.js';

/** Fiche d'un jeu : rendu statique. */

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
  notice: {
    goal: 'Répondre le plus vite et le plus juste possible.',
    steps: ['Chacun répond sur son téléphone.', 'Le score s’affiche sur l’écran.'],
    tips: ['Les bonus de rapidité comptent double.'],
  },
} as unknown as CatalogGame;

const sibling = { ...quiz, id: 'quiz-duo', name: 'Quiz Duo', description: 'À deux.' } as unknown as CatalogGame;

const handlers = {
  onCreate: () => undefined,
  onCreateNoScreen: () => undefined,
  onTry: () => undefined,
};

function sheet(over: Partial<Parameters<typeof GameSheet>[0]> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <GameSheet
        game={quiz}
        recent={false}
        sameCategory={[]}
        creating={false}
        trying={false}
        error={null}
        {...handlers}
        {...over}
      />
    </MemoryRouter>,
  );
}

describe('GameSheet', () => {
  it('présente le jeu : titre, description, repères et actions', () => {
    const html = sheet();
    expect(html).toContain('<h1 class="sheet-title">Quiz Party</h1>');
    expect(html).toContain('Des questions, des bonus de rapidité.');
    expect(html).toContain('2 à 8 joueurs');
    expect(html).toContain('environ 15 min');
    expect(html).toContain('Avec IA');
    expect(html).toContain('Créer la salle');
    expect(html).toContain('Essayer seul');
  });

  it('affiche la notice : but, déroulé et astuces', () => {
    const html = sheet();
    expect(html).toContain('Répondre le plus vite et le plus juste possible.');
    expect(html).toContain('Chacun répond sur son téléphone.');
    expect(html).toContain('Les bonus de rapidité comptent double.');
    expect(html).toContain('<ol class="sheet-steps">');
  });

  it('sans étapes ni astuces, n’affiche pas ces rubriques vides', () => {
    const bare = { ...quiz, notice: { goal: 'But.', steps: [], tips: [] } } as unknown as CatalogGame;
    const html = sheet({ game: bare });
    expect(html).not.toContain('Déroulé');
    expect(html).not.toContain('Astuces');
  });

  it('fiche technique : type, joueurs, durée, IA, version et état sur cet appareil', () => {
    const html = sheet({ recent: true });
    expect(html).toContain('<dd>Quiz</dd>');
    expect(html).toContain('<dd>Oui, quand elle est configurée</dd>');
    expect(html).toContain('<dd>1.4.0</dd>');
    expect(html).toContain('Joué récemment');
  });

  it('indique un jeu jamais lancé ici', () => {
    expect(sheet({ recent: false })).toContain('Pas encore lancé depuis cet appareil');
  });

  it('sans IA, le repère IA disparaît', () => {
    const plain = { ...quiz, ai: false } as unknown as CatalogGame;
    const html = sheet({ game: plain });
    expect(html).not.toContain('Avec IA');
    expect(html).toContain('<dd>Non</dd>');
  });

  it('affiche les autres jeux de la catégorie avec leur lien vers la fiche', () => {
    const html = sheet({ sameCategory: [sibling] });
    expect(html).toContain('Dans la même catégorie');
    expect(html).toContain('href="/jeux/quiz-duo"');
  });

  it('cache la section des jeux liés quand il n’y en a pas', () => {
    expect(sheet({ sameCategory: [] })).not.toContain('Dans la même catégorie');
  });

  it('pendant une création, désactive toutes les actions', () => {
    const html = sheet({ creating: true });
    expect(html).toContain('Création…');
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });

  it('affiche une erreur lisible', () => {
    expect(sheet({ error: 'Salle impossible à créer.' })).toContain('role="alert"');
  });

  it('n’expose ni NaN ni undefined', () => {
    expect(sheet()).not.toMatch(/NaN|undefined/);
  });
});

describe('playersText', () => {
  it('écrit le singulier, le pluriel et la fourchette', () => {
    expect(playersText({ minPlayers: 1, maxPlayers: 1 })).toBe('1 joueur');
    expect(playersText({ minPlayers: 4, maxPlayers: 4 })).toBe('4 joueurs');
    expect(playersText({ minPlayers: 2, maxPlayers: 8 })).toBe('2 à 8 joueurs');
  });
});

describe('Créer sans écran', () => {
  it('propose « Créer sans écran » à côté de « Créer la salle »', () => {
    const html = sheet();
    expect(html).toContain('Créer la salle');
    expect(html).toContain('Créer sans écran');
  });
});
