import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { detectPlatform } from '../certificate/platform.js';
import { CertificatePage } from '../pages/CertificatePage.js';

/** Page d'installation du certificat : téléchargement direct, instructions adaptées à l'appareil. */

describe('detectPlatform', () => {
  it('reconnaît les systèmes courants', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(detectPlatform('Mozilla/5.0 (SmartTV; Tizen)')).toBe('autre');
  });

  it('reconnaît un iPad qui se présente comme un Mac grâce à son écran tactile', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('mac');
  });
});

describe('CertificatePage', () => {
  const page = (platform: Parameters<typeof CertificatePage>[0]['platform']) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <CertificatePage platform={platform} />
      </MemoryRouter>,
    );

  it('propose le téléchargement du fichier racine, sans passer par l’application', () => {
    const html = page('android');
    expect(html).toContain('href="/certificat/racine.crt"');
    expect(html).toContain('download="partyhub-autorite-locale.crt"');
    expect(html).toContain('Télécharger le certificat');
  });

  it('ouvre les instructions de l’appareil détecté et replie les autres', () => {
    const html = page('android');
    expect(html).toContain('Installer sur cet appareil : Android');
    expect(html).toContain('Certificat CA');
    expect(html).toContain('<details');
    expect(html).toContain('Installer sur un autre appareil');
    expect(html).toContain('iPhone et iPad');
  });

  it('explique l’avertissement qui précède l’installation, et offre un retour', () => {
    const html = page('ios');
    expect(html).toContain('Continuer');
    expect(html).toContain('aria-label="Fil d’Ariane"');
    expect(html).toContain('href="/"');
    expect(html).toContain('Caddy Local Authority');
    expect(html).not.toMatch(/NaN|undefined/);
  });
});
