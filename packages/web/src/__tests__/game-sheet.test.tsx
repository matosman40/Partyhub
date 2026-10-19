import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { GameSheet, playersText, releaseDateText } from '../components/GameSheet.js';

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

  it('pendant une création, désactive les deux actions', () => {
    const html = sheet({ creating: true });
    expect(html).toContain('Création…');
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it('affiche une erreur lisible', () => {
    expect(sheet({ error: 'Salle impossible à créer.' })).toContain('role="alert"');
  });

  it('n’expose ni NaN ni undefined', () => {
    expect(sheet()).not.toMatch(/NaN|undefined/);
  });

  it('affiche le journal des versions, la plus récente en tête, avec sa date', () => {
    const withLog = {
      ...quiz,
      changelog: [
        { version: '1.4.0', date: '2026-10-18', changes: ['Thèmes des joueurs confiés à l’IA.'] },
        { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
      ],
    } as unknown as CatalogGame;
    const html = sheet({ game: withLog });
    expect(html).toContain('Journal des versions');
    expect(html.indexOf('Version 1.4.0')).toBeLessThan(html.indexOf('Version 1.0.0'));
    expect(html).toContain('Thèmes des joueurs confiés à l’IA.');
    expect(html).toMatch(/<time[^>]*"2026-10-18"/);
    expect(html).toContain('18 octobre 2026');
    expect(html).toContain('Actuelle');
    expect(html).toContain('Dernière mise à jour');
  });

  it('sans journal, la section est absente', () => {
    const html = sheet();
    expect(html).not.toContain('Journal des versions');
    expect(html).not.toContain('Dernière mise à jour');
  });
});

describe('releaseDateText', () => {
  it('écrit la date en français, et montre une date illisible telle quelle', () => {
    expect(releaseDateText('2026-10-14')).toBe('14 octobre 2026');
    expect(releaseDateText('pas une date')).toBe('pas une date');
  });
});

describe('playersText', () => {
  it('écrit le singulier, le pluriel et la fourchette', () => {
    expect(playersText({ minPlayers: 1, maxPlayers: 1 })).toBe('1 joueur');
    expect(playersText({ minPlayers: 4, maxPlayers: 4 })).toBe('4 joueurs');
    expect(playersText({ minPlayers: 2, maxPlayers: 8 })).toBe('2 à 8 joueurs');
  });
});
