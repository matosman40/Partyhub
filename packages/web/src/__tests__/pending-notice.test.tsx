import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PendingNotice,
  PENDING_LIST_GAMES,
  RANKING_SHOWN,
  pendingNames,
  rankingLines,
} from '../components/PendingNotice.js';

/**
 * Bandeau « En attente » sur le téléphone : affiché seulement pour les jeux qui publient la liste,
 * seulement quand des joueurs sont attendus, et sans toucher aux autres jeux.
 */
describe('Bandeau « En attente » sur le téléphone', () => {
  it('couvre les onze jeux qui publient la liste', () => {
    expect(PENDING_LIST_GAMES.size).toBe(11);
    expect(PENDING_LIST_GAMES.has('quiz-party')).toBe(true);
    expect(PENDING_LIST_GAMES.has('aventure-ia')).toBe(true);
  });

  it('affiche les noms attendus', () => {
    const html = renderToStaticMarkup(<PendingNotice gameId="quiz-party" publicState={{ pending: ['Ana', 'Léo'] }} />);
    expect(html).toContain('En attente : Ana, Léo');
    expect(html).toContain('role="status"');
  });

  it('n’affiche rien quand personne n’est attendu', () => {
    expect(renderToStaticMarkup(<PendingNotice gameId="quiz-party" publicState={{ pending: [] }} />)).toBe('');
    expect(renderToStaticMarkup(<PendingNotice gameId="quiz-party" publicState={{}} />)).toBe('');
    expect(renderToStaticMarkup(<PendingNotice gameId="quiz-party" publicState={null} />)).toBe('');
  });

  it('ignore les jeux hors liste, même si leur vue a un champ pending', () => {
    expect(pendingNames('promoteur', { pending: { index: 3 } })).toEqual([]);
    expect(pendingNames('reflexe', { pending: ['Ana'] })).toEqual([]);
    expect(renderToStaticMarkup(<PendingNotice gameId="promoteur" publicState={{ pending: ['Ana'] }} />)).toBe('');
  });

  it('écarte les entrées qui ne sont pas des noms', () => {
    expect(pendingNames('quiz-party', { pending: ['Ana', '', 3, null, 'Léo'] })).toEqual(['Ana', 'Léo']);
  });
});

describe('Classement commun sur le téléphone', () => {
  it('affiche les premiers rangs du classement public', () => {
    const html = renderToStaticMarkup(
      <PendingNotice
        gameId="quiz-party"
        publicState={{
          ranking: [
            { playerId: 'a', name: 'Ana', points: 12, rank: 1 },
            { playerId: 'b', name: 'Léo', points: 1, rank: 2 },
          ],
        }}
      />,
    );
    expect(html).toContain('Classement : 1. Ana 12 pts · 2. Léo 1 pt');
  });

  it('ne garde que les cinq premiers rangs', () => {
    const ranking = Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i}`,
      name: `J${i}`,
      points: 10 - i,
      rank: i + 1,
    }));
    expect(rankingLines('quiz-party', { ranking })).toHaveLength(RANKING_SHOWN);
  });

  it('ignore les entrées de classement mal formées et les jeux hors liste', () => {
    expect(rankingLines('quiz-party', { ranking: [{ name: 3, points: 2 }, null, { name: 'Ana', points: 4 }] })).toEqual(
      [{ rank: 1, name: 'Ana', points: 4 }],
    );
    expect(rankingLines('promoteur', { ranking: [{ name: 'Ana', points: 4 }] })).toEqual([]);
    expect(
      renderToStaticMarkup(
        <PendingNotice gameId="promoteur" publicState={{ ranking: [{ name: 'Ana', points: 4 }] }} />,
      ),
    ).toBe('');
  });
});
