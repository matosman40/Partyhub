import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { GameCard } from '../components/GameCard.js';
import { CatalogFilterPanel } from '../components/CatalogFilterPanel.js';
import { DEFAULT_FILTERS, type CatalogFilters } from '../catalog/filters.js';

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

function panel(
  over: Partial<CatalogFilters> = {},
  props: { hidden?: boolean; recentCount?: number; activeCount?: number } = {},
) {
  return renderToStaticMarkup(
    <CatalogFilterPanel
      id="catalog-filters"
      hidden={props.hidden ?? false}
      filters={{ ...DEFAULT_FILTERS, ...over }}
      categories={['quiz', 'solo']}
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

  it('ne propose que les catégories présentes dans le catalogue', () => {
    const html = panel();
    expect(html).toContain('Quiz');
    expect(html).toContain('Solo');
    expect(html).not.toContain('Cartes');
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
