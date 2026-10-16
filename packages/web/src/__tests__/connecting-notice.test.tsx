import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectingNotice, CONNECTING_SLOW_MS } from '../components/ConnectingNotice.js';

/**
 * Attente de connexion à une salle : jamais un écran vide. Le rappel « Réessayer » n'apparaît
 * qu'après un délai ; une erreur du salon remplace l'attente.
 */
describe('Attente de connexion à une salle', () => {
  it('affiche d’abord le message de connexion, sans bouton de nouvel essai', () => {
    const html = renderToStaticMarkup(<ConnectingNotice />);
    expect(html).toContain('Connexion à la salle…');
    expect(html).not.toContain('Réessayer');
  });

  it('montre l’erreur du salon à la place de l’attente', () => {
    const html = renderToStaticMarkup(<ConnectingNotice error="Salle introuvable ou accès refusé." />);
    expect(html).toContain('Salle introuvable ou accès refusé.');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Connexion à la salle…');
  });

  it('attend plusieurs secondes avant de proposer de réessayer', () => {
    expect(CONNECTING_SLOW_MS).toBeGreaterThanOrEqual(5000);
  });
});
