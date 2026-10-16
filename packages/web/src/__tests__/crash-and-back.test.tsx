import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BackButton } from '../components/BackButton.js';
import { CrashScreen } from '../components/CrashScreen.js';
import { Boundary } from '../components/Boundary.js';

/**
 * Pas d'écran noir : une erreur de rendu affiche un message et une sortie, et chaque page
 * propose un bouton retour du même style.
 */

describe('BackButton', () => {
  it('renvoie vers une page avec un lien stylé en bouton retour', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BackButton to="/">Retour à l’accueil</BackButton>
      </MemoryRouter>,
    );
    expect(html).toContain('<a');
    expect(html).toContain('href="/"');
    expect(html).toContain('back-btn');
    expect(html).toContain('Retour à l’accueil');
    expect(html).toContain('←');
  });

  it('sans destination, agit sur place avec un bouton', () => {
    const html = renderToStaticMarkup(<BackButton onClick={() => undefined}>Menu</BackButton>);
    expect(html).toContain('<button');
    expect(html).toContain('back-btn');
    expect(html).not.toContain('<a');
  });
});

describe('CrashScreen', () => {
  it('affiche un message, le détail technique et deux sorties, sans écran vide', () => {
    const html = renderToStaticMarkup(<CrashScreen error={new Error('Cannot read properties of undefined')} />);
    expect(html).toContain('Cette page n’a pas pu s’afficher');
    expect(html).toContain('Recharger la page');
    expect(html).toContain('href="/"');
    expect(html).toContain('Cannot read properties of undefined');
  });

  it('affiche le nom de l’erreur quand elle n’a pas de message', () => {
    const error = new Error('');
    error.name = 'ChunkLoadError';
    const html = renderToStaticMarkup(<CrashScreen error={error} />);
    expect(html).toContain('ChunkLoadError');
  });
});

describe('Boundary', () => {
  it("passe l'erreur au repli quand un enfant plante", () => {
    const error = new Error('boom');
    expect(Boundary.getDerivedStateFromError(error)).toEqual({ error });

    const fallback = vi.fn((e: Error) => `repli : ${e.message}`);
    const boundary = new Boundary({ children: 'contenu', fallback });
    boundary.state = { error };
    expect(boundary.render()).toBe('repli : boom');
    expect(fallback).toHaveBeenCalledWith(error);
  });

  it('affiche les enfants tant qu’aucune erreur ne survient', () => {
    const boundary = new Boundary({ children: 'contenu', fallback: 'repli' });
    expect(boundary.render()).toBe('contenu');
  });
});
