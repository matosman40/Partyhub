import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { SearchPalette } from '../nav/SearchPalette.js';
import { SearchButton } from '../nav/SearchButton.js';

/** Navigation commune : rendu statique, sans navigateur. */

describe('Breadcrumb', () => {
  it('ouvre les étapes précédentes et marque la page courante', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Breadcrumb
          items={[
            { label: 'Accueil', to: '/' },
            { label: 'Administration', onClick: () => undefined },
            { label: 'Jeux' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Fil d’Ariane"');
    expect(html).toContain('href="/"');
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-current="page">Jeux<');
    expect(html.match(/›/g)).toHaveLength(2);
  });

  it('ne rend pas de lien pour la dernière étape, même avec une adresse', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Breadcrumb
          items={[
            { label: 'Accueil', to: '/' },
            { label: 'Profil', to: '/profil' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(html).not.toContain('href="/profil"');
    expect(html).toContain('aria-current="page">Profil<');
  });
});

describe('SearchPalette', () => {
  it('se présente comme une boîte de dialogue modale avec une liste d’options', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SearchPalette onClose={() => undefined} />
      </MemoryRouter>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('Échap pour fermer');
  });
});

describe('SearchButton', () => {
  it('annonce le raccourci clavier', () => {
    const html = renderToStaticMarkup(<SearchButton />);
    expect(html).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(html).toContain('Rechercher');
  });
});

describe('pages sans bouton « Retour à l’accueil » isolé', () => {
  const pages = ['ProfilePage', 'CertificatePage', 'DeviceTestPage', 'JoinPage', 'StorePage'];
  for (const page of pages) {
    it(`${page} utilise le fil d’Ariane`, () => {
      const source = readFileSync(new URL(`../pages/${page}.tsx`, import.meta.url), 'utf8');
      expect(source).toContain('Breadcrumb');
      expect(source).not.toContain('Retour à l’accueil');
      expect(source).not.toContain('← Accueil');
    });
  }
});
