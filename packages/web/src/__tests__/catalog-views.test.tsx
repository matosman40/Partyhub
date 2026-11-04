import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { GameCard } from '../components/GameCard.js';
import { GameListRow } from '../components/GameListRow.js';
import { CatalogCategoryPills } from '../components/CatalogCategoryPills.js';
import { CatalogFilterPanel } from '../components/CatalogFilterPanel.js';
import { DEFAULT_FILTERS, type CatalogFilters } from '../catalog/filters.js';
import { countHiddenFilters, HomePage } from '../pages/HomePage.js';

/** Fiche du catalogue et panneau de filtres : rendu statique, sans navigateur. */

const quiz = {
  id: 'quiz-party',
  name: 'Quiz Party',
  description: 'Des questions, des bonus de rapidité.',
  category: 'quiz',
  minPlayers: 2,
  maxPlayers: 8,
  durationMin: 15,
  ai: true,
} as unknown as CatalogGame;

function card(over: Partial<CatalogGame> = {}, compact = false) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <GameCard game={{ ...quiz, ...over }} compact={compact} />
    </MemoryRouter>,
  );
}

describe('GameCard', () => {
  it('mène à la fiche du jeu et affiche ses repères', () => {
    const html = card();
    expect(html).toContain('href="/jeux/quiz-party"');
    expect(html).toContain('Quiz Party');
    expect(html).toContain('Des questions, des bonus de rapidité.');
    expect(html).toContain('>Quiz<');
    expect(html).toContain('2 à 8 joueurs');
    expect(html).toContain('15 min');
    expect(html).toContain('tag-ai');
  });

  it('affiche l’emblème des jeux intégrés', () => {
    const html = card();
    expect(html).toContain('src="/game-icons/quiz-party.webp"');
    expect(html).toContain('<span class="game-card-name">Quiz Party</span>');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="512" height="512"');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('game-logo');
  });

  it('garde le logo SVG pour un jeu sans emblème', () => {
    const html = card({ id: 'jeu-installe', name: 'Jeu installé' });
    expect(html).toContain('game-logo');
    expect(html).not.toContain('/game-icons/jeu-installe.webp');
  });

  it('sans IA, n’affiche pas le repère IA', () => {
    expect(card({ ai: false })).not.toContain('tag-ai');
  });

  it('en version compacte, retire la description', () => {
    const html = card({}, true);
    expect(html).toContain('is-compact');
    expect(html).not.toContain('game-card-desc');
  });

  it('n’expose ni NaN ni undefined', () => {
    expect(card()).not.toMatch(/NaN|undefined/);
  });
});

describe('GameListRow', () => {
  it('affiche la même vignette emblème dans la vue Liste', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GameListRow game={quiz} />
      </MemoryRouter>,
    );
    expect(html).toContain('src="/game-icons/quiz-party.webp"');
    expect(html).toContain('class="game-row-emblem"');
  });
});

describe('CatalogCategoryPills', () => {
  it('propose Tous et uniquement les catégories présentes avec leur état sélectionné', () => {
    const html = renderToStaticMarkup(
      <CatalogCategoryPills categories={['quiz', 'solo']} selected={['quiz']} onChange={() => undefined} />,
    );
    expect(html).toContain('aria-label="Catégories de jeux"');
    expect(html).toContain('<button type="button" aria-pressed="false">Tous</button>');
    expect(html).toContain('aria-pressed="true">Quiz</button>');
    expect(html).toContain('aria-pressed="false">Solo</button>');
    expect(html).not.toContain('Cartes');
  });
});

describe('HomePage', () => {
  it('affiche seulement Jouer et Rejoindre comme actions principales', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect([...html.matchAll(/class="home-action /g)]).toHaveLength(2);
    expect(html).toContain('href="#catalog"');
    expect(html).toContain('>Jouer</span>');
    expect(html).toContain('href="/join"');
    expect(html).toContain('>Rejoindre</span>');
    expect(html).not.toContain('Magasin de jeux</span>');
    expect(html).not.toContain('Administration</span>');
  });
});

describe('countHiddenFilters', () => {
  it('ne compte que les filtres derrière « Plus de filtres »', () => {
    expect(countHiddenFilters({ ...DEFAULT_FILTERS, categories: ['quiz'] })).toBe(0);
    expect(
      countHiddenFilters({
        ...DEFAULT_FILTERS,
        categories: ['quiz'],
        players: 4,
        duration: 'short',
        ai: 'yes',
        recent: true,
      }),
    ).toBe(4);
  });
});

function panel(
  over: Partial<CatalogFilters> = {},
  props: { hidden?: boolean; recentCount?: number; activeCount?: number } = {},
) {
  return renderToStaticMarkup(
    <CatalogFilterPanel
      id="catalog-filters"
      hidden={props.hidden ?? false}
      filters={{ ...DEFAULT_FILTERS, ...over }}
      recentCount={props.recentCount ?? 0}
      activeCount={props.activeCount ?? 0}
      onChange={() => undefined}
      onReset={() => undefined}
    />,
  );
}

describe('CatalogFilterPanel', () => {
  it('est masqué quand il est replié sur téléphone', () => {
    expect(panel({}, { hidden: true })).toMatch(/<aside[^>]*hidden=""/);
    expect(panel({}, { hidden: false })).not.toMatch(/<aside[^>]*hidden/);
  });

  it('ne contient plus les catégories proposées en pastilles au-dessus de la grille', () => {
    expect(panel()).not.toContain('Type de jeu');
    expect(panel()).not.toContain('Quiz');
  });

  it('coche le filtre IA et la durée choisis', () => {
    const html = panel({ ai: 'yes', duration: 'medium' });
    expect(html).toContain('checked=""/><span>Avec IA</span>');
    expect(html).toContain('checked=""/><span>De 10 à 25 min</span>');
    expect(html).not.toContain('checked=""/><span>Peu importe</span>');
  });

  it('désactive « Joués récemment » tant qu’aucun jeu n’a été lancé ici', () => {
    expect(panel({}, { recentCount: 0 })).toMatch(/type="checkbox"[^>]*disabled=""/);
    expect(panel({}, { recentCount: 2 })).not.toMatch(/type="checkbox"[^>]*disabled=""/);
  });

  it('désactive « Effacer les filtres » quand aucun filtre n’est actif', () => {
    expect(panel({}, { activeCount: 0 })).toMatch(/filters-reset"[^>]*disabled=""|disabled=""[^>]*filters-reset/);
    expect(panel({ ai: 'no' }, { activeCount: 1 })).not.toMatch(/filters-reset"[^>]*disabled=""/);
  });
});
