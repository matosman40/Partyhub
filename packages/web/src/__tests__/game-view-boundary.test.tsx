import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Boundary } from '../components/Boundary.js';
import { GameViewFallback, stepKeyOf } from '../components/GameView.js';

/**
 * Une vue de jeu en erreur ne fait pas tomber la page : un message dit ce qui se passe, et la vue
 * reprend à l'étape suivante du jeu.
 */

describe('Vue de jeu en erreur', () => {
  it('affiche un message clair, annoncé aux lecteurs d’écran, sans jargon technique', () => {
    const html = renderToStaticMarkup(<GameViewFallback />);
    expect(html).toContain('Cette étape du jeu n’a pas pu s’afficher.');
    expect(html).toContain('La partie continue');
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/Error|undefined|NaN/);
  });

  it('change de clé à chaque étape ou manche, et seulement alors', () => {
    const quiz = { phase: 'question', round: 2, players: [1, 2, 3] };
    expect(stepKeyOf('quiz-party', quiz)).toBe(stepKeyOf('quiz-party', { ...quiz, players: [] }));
    expect(stepKeyOf('quiz-party', quiz)).not.toBe(stepKeyOf('quiz-party', { ...quiz, phase: 'reveal' }));
    expect(stepKeyOf('quiz-party', quiz)).not.toBe(stepKeyOf('quiz-party', { ...quiz, round: 3 }));
    expect(stepKeyOf('quiz-party', quiz)).not.toBe(stepKeyOf('reflexe', quiz));
  });

  it('retombe sur l’identifiant du jeu quand l’état public n’est pas un objet', () => {
    expect(stepKeyOf('sudoku', null)).toBe('sudoku');
    expect(stepKeyOf('sudoku', 'texte')).toBe('sudoku');
    expect(stepKeyOf('sudoku', { phase: { objet: true } })).toBe('sudoku||');
  });
});

describe('Limite d’erreur réinitialisable', () => {
  /** Instance de Boundary sans rendu : on suit seulement l'état et la mise à jour. */
  function boundaryWithError(resetKey: string) {
    const props = { children: 'contenu', fallback: 'repli', resetKey };
    const boundary = new Boundary(props);
    let state = { error: new Error('boom') as Error | null };
    boundary.state = state;
    boundary.setState = ((partial: { error: Error | null }) => {
      state = { ...state, ...partial };
      boundary.state = state;
    }) as unknown as typeof boundary.setState;
    return {
      boundary,
      current: () => state.error,
      update(nextKey: string) {
        const previous = { ...props };
        Object.assign(boundary, { props: { ...props, resetKey: nextKey } });
        boundary.componentDidUpdate(previous);
      },
    };
  }

  it('essaie de nouveau de s’afficher quand l’étape change', () => {
    const b = boundaryWithError('quiz-party|question|1');
    b.update('quiz-party|reveal|1');
    expect(b.current()).toBeNull();
  });

  it('garde le repli tant que l’étape ne change pas', () => {
    const b = boundaryWithError('quiz-party|question|1');
    b.update('quiz-party|question|1');
    expect(b.current()).toBeInstanceOf(Error);
  });
});
